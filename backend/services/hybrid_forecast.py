"""
Forecast pipeline from DDMRP_Hybrid_Algorithm.ipynb (model comparison + train/test split).
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import ElasticNet
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import MinMaxScaler

warnings.filterwarnings("ignore")

TRAIN_RATIO = 0.80


def compute_metrics(actual, predicted, naive_err=None):
    actual = np.array(actual, dtype=float)
    predicted = np.array(predicted, dtype=float)
    err = actual - predicted
    abs_err = np.abs(err)
    mae = np.mean(abs_err)
    rmse = np.sqrt(np.mean(err**2))
    bias = np.mean(err)
    nz = actual > 0
    mape = np.mean(abs_err[nz] / actual[nz]) * 100 if nz.sum() > 0 else np.nan
    mase = mae / naive_err if naive_err and naive_err > 0 else np.nan
    w20 = (abs_err[nz] / actual[nz] <= 0.20).mean() * 100 if nz.sum() > 0 else np.nan
    w10 = (abs_err[nz] / actual[nz] <= 0.10).mean() * 100 if nz.sum() > 0 else np.nan
    return {
        "MAE": round(mae, 2),
        "RMSE": round(rmse, 2),
        "MAPE*": round(mape, 2) if not np.isnan(mape) else None,
        "MASE": round(mase, 4) if not np.isnan(mase) else None,
        "Bias": round(bias, 2),
        "Within10pct": round(w10, 1) if not np.isnan(w10) else None,
        "Within20pct": round(w20, 1) if not np.isnan(w20) else None,
        "N_zero": int((actual == 0).sum()),
    }


def naive_mae(train):
    return float(np.mean(np.abs(np.diff(train)))) if len(train) > 1 else 1.0


def forecast_ma(train, n, window=7):
    h = list(train)
    p = []
    for _ in range(n):
        p.append(np.mean(h[-min(window, len(h)) :]))
        h.append(p[-1])
    return np.array(p)


def forecast_ses(train, n):
    def mse(a):
        s = train[0]
        e = 0
        for v in train[1:]:
            e += (v - s) ** 2
            s = a[0] * v + (1 - a[0]) * s
        return e

    res = minimize(mse, [0.3], bounds=[(0.01, 0.99)], method="L-BFGS-B")
    alpha = float(res.x[0])
    s = train[0]
    for v in train[1:]:
        s = alpha * v + (1 - alpha) * s
    return np.full(n, max(s, 0)), alpha


def forecast_holt(train, n):
    def sse(p):
        a, b = p
        lv = train[0]
        tr = train[1] - train[0] if len(train) > 1 else 0
        e = 0
        for v in train[1:]:
            e += (v - lv - tr) ** 2
            nl = a * v + (1 - a) * (lv + tr)
            tr = b * (nl - lv) + (1 - b) * tr
            lv = nl
        return e

    res = minimize(sse, [0.3, 0.1], bounds=[(0.01, 0.99)] * 2, method="L-BFGS-B")
    a, b = res.x
    lv = train[0]
    tr = train[1] - train[0] if len(train) > 1 else 0
    for v in train[1:]:
        nl = a * v + (1 - a) * (lv + tr)
        tr = b * (nl - lv) + (1 - b) * tr
        lv = nl
    return np.maximum([lv + (h + 1) * tr for h in range(n)], 0), a, b


def forecast_holtwinters(train, n, season=7):
    if len(train) < 2 * season:
        p, _, _ = forecast_holt(train, n)
        return p

    def hw(p):
        a, b, g = p
        lv = np.mean(train[:season])
        tr = (np.mean(train[season : 2 * season]) - np.mean(train[:season])) / season
        se = [train[i] - lv for i in range(season)]
        e = 0
        for t in range(len(train)):
            si = t % season
            e += (train[t] - lv - tr - se[si]) ** 2
            nl = a * (train[t] - se[si]) + (1 - a) * (lv + tr)
            tr = b * (nl - lv) + (1 - b) * tr
            se[si] = g * (train[t] - nl) + (1 - g) * se[si]
            lv = nl
        return e

    res = minimize(hw, [0.3, 0.1, 0.1], bounds=[(0.01, 0.99)] * 3, method="L-BFGS-B")
    a, b, g = res.x
    lv = np.mean(train[:season])
    tr = (np.mean(train[season : 2 * season]) - np.mean(train[:season])) / season
    se = [train[i] - lv for i in range(season)]
    for t in range(len(train)):
        si = t % season
        nl = a * (train[t] - se[si]) + (1 - a) * (lv + tr)
        tr = b * (nl - lv) + (1 - b) * tr
        se[si] = g * (train[t] - nl) + (1 - g) * se[si]
        lv = nl
    return np.maximum(
        [lv + (h + 1) * tr + se[(len(train) + h) % season] for h in range(n)], 0
    )


def forecast_croston(train, n, alpha=0.1):
    nz = np.where(train > 0)[0]
    if len(nz) < 2:
        return np.full(n, np.mean(train))
    z = float(train[nz[0]])
    p = float(nz[0] + 1)
    q = 0
    for t in range(1, len(train)):
        q += 1
        if train[t] > 0:
            z = alpha * train[t] + (1 - alpha) * z
            p = alpha * q + (1 - alpha) * p
            q = 0
    return np.full(n, max(z / p, 0))


def clean_demand_adaptive(series, dates, adu=None, low_pct=0.02, verbose=True):
    series = np.array(series, dtype=float)
    if adu is None:
        adu = np.mean(series[series > 0])

    low_thr = adu * low_pct
    nz = series[series > 0]
    Q1, Q3 = np.percentile(nz, 25), np.percentile(nz, 75)
    high_thr = Q3 + 2.0 * (Q3 - Q1)

    mask = (series < low_thr) | (series > high_thr)
    cleaned = series.copy()
    for i in np.where(mask)[0]:
        lo = max(0, i - 7)
        hi = min(len(series), i + 8)
        nbrs = series[lo:hi]
        valid = nbrs[(nbrs >= low_thr) & (nbrs <= high_thr)]
        cleaned[i] = (
            np.median(valid)
            if len(valid) >= 3
            else np.median(nz[(nz >= low_thr) & (nz <= high_thr)])
        )

    rows = []
    for i in np.where(mask)[0]:
        rows.append(
            {
                "Hari": i + 1,
                "Tanggal": dates.iloc[i].date() if i < len(dates) else None,
                "Nilai Asli": series[i],
                "Nilai Baru": cleaned[i],
                "Tipe": "LOW" if series[i] < low_thr else "HIGH",
            }
        )
    rpt = pd.DataFrame(rows)
    if verbose and not rpt.empty:
        print(f"  Threshold: LOW<{low_thr:.1f} | HIGH>{high_thr:.1f}")
        print(f"  Anomali  : {len(rpt)} hari")
        print(rpt.to_string(index=False))
    return cleaned, rpt


def make_features(all_series, all_dates, all_promo_pct, all_ispromo):
    df = pd.DataFrame({"y": all_series, "date": pd.to_datetime(all_dates)})
    y_s = df["y"].shift(1)

    for lag in [1, 2, 3, 7, 14, 21, 28]:
        df[f"lag_{lag}"] = df["y"].shift(lag)
    for w in [7, 14, 28]:
        df[f"rm_{w}"] = y_s.rolling(w, min_periods=3).mean()
        df[f"rs_{w}"] = y_s.rolling(w, min_periods=3).std()
    df["ewm7"] = y_s.ewm(span=7, min_periods=3).mean()
    df["ewm14"] = y_s.ewm(span=14, min_periods=3).mean()

    df["dow"] = df["date"].dt.dayofweek
    df["month"] = df["date"].dt.month
    df["day"] = df["date"].dt.day
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    df["is_payday"] = df["day"].isin([25, 26, 27, 28, 1, 2, 3]).astype(int)
    df["is_mon"] = (df["dow"] == 0).astype(int)
    df["is_fri"] = (df["dow"] == 4).astype(int)

    promo_arr = np.array(all_ispromo, dtype=int)
    disc_arr = np.array(all_promo_pct, dtype=float)
    df["is_promo"] = promo_arr
    df["promo_discount"] = disc_arr
    df["promo_lag1"] = pd.Series(promo_arr).shift(1).fillna(0).values
    df["promo_lag7"] = pd.Series(promo_arr).shift(7).fillna(0).values
    df["disc_lag1"] = pd.Series(disc_arr).shift(1).fillna(0).values

    post1 = np.zeros(len(promo_arr), dtype=int)
    for i in range(1, len(promo_arr)):
        if promo_arr[i] == 0 and promo_arr[i - 1] == 1:
            post1[i] = 1
    df["post_promo1"] = post1

    return df.drop(columns=["date"])


def split_xy(all_series, tr_d, te_d, promo_df, n_train):
    all_dates = pd.concat([tr_d, te_d], ignore_index=True)
    all_promo = pd.concat(
        [promo_df.iloc[:n_train], promo_df.iloc[n_train:]], ignore_index=True
    )

    df = make_features(
        all_series,
        all_dates,
        all_promo["PromoDiscountPct"].values,
        all_promo["IsPromo"].astype(int).values,
    )
    df["y"] = all_series
    fcols = [c for c in df.columns if c != "y"]

    df_tr = df.iloc[:n_train].dropna()
    df_te = df.iloc[n_train:].copy()
    X_tr = df_tr[fcols]
    y_tr = df_tr["y"]
    X_te = df_te[fcols].copy()
    for col in X_te.columns:
        if X_te[col].isna().any():
            X_te[col] = X_te[col].fillna(X_tr[col].mean())
    return X_tr, y_tr, X_te


def run_elasticnet(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr, te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    sx = MinMaxScaler()
    m = ElasticNet(alpha=0.1, l1_ratio=0.5, max_iter=2000)
    m.fit(sx.fit_transform(X_tr), y_tr)
    return np.maximum(m.predict(sx.transform(X_te)), 0)


def run_hgb(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr, te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    m = HistGradientBoostingRegressor(
        max_iter=300, learning_rate=0.05, max_depth=5, random_state=42
    )
    m.fit(X_tr, y_tr)
    return np.maximum(m.predict(X_te), 0)


def run_rf(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr, te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    m = RandomForestRegressor(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=4,
        n_jobs=-1,
        random_state=42,
    )
    m.fit(X_tr, y_tr)
    return np.maximum(m.predict(X_te), 0)


def run_mlp(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr, te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    sx = MinMaxScaler()
    sy = MinMaxScaler()
    m = MLPRegressor(
        hidden_layer_sizes=(128, 64),
        activation="relu",
        learning_rate_init=0.001,
        max_iter=500,
        early_stopping=True,
        random_state=42,
    )
    m.fit(
        sx.fit_transform(X_tr),
        sy.fit_transform(y_tr.values.reshape(-1, 1)).ravel(),
    )
    return np.maximum(
        sy.inverse_transform(m.predict(sx.transform(X_te)).reshape(-1, 1)).ravel(), 0
    )


def run_dow_en(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr, te])
    all_d = pd.concat([tr_d, te_d], ignore_index=True)
    all_p = pd.concat(
        [
            promo_df.iloc[: len(tr)],
            promo_df.iloc[len(tr) : len(tr) + len(te)],
        ],
        ignore_index=True,
    )
    df_feat = make_features(
        all_s,
        all_d,
        all_p["PromoDiscountPct"].values,
        all_p["IsPromo"].astype(int).values,
    )
    df_feat["y"] = all_s
    fcols = [c for c in df_feat.columns if c != "y"]
    df_tr = df_feat.iloc[: len(tr)].dropna()
    df_te = df_feat.iloc[len(tr) :].copy()
    dow_tr = pd.to_datetime(tr_d).dt.dayofweek.values
    dow_te = pd.to_datetime(te_d).dt.dayofweek.values
    preds = np.zeros(len(te))
    for seg, dows in [("WD", [0, 1, 2, 3, 4]), ("WE", [5, 6])]:
        mtr = np.isin(dow_tr[: len(df_tr)], dows)
        mte = np.isin(dow_te, dows)
        Xs = df_tr[fcols].iloc[mtr]
        ys = df_tr["y"].iloc[mtr]
        Xp = df_te[fcols].iloc[mte].copy()
        if len(Xs) < 5 or len(Xp) == 0:
            preds[mte] = np.mean(tr)
            continue
        for col in Xp.columns:
            if Xp[col].isna().any():
                Xp[col] = Xp[col].fillna(Xs[col].mean())
        sx = MinMaxScaler()
        m = ElasticNet(alpha=0.1, l1_ratio=0.5, max_iter=2000)
        m.fit(sx.fit_transform(Xs), ys)
        preds[mte] = np.maximum(m.predict(sx.transform(Xp)), 0)
    return preds


def run_ensemble_ga(preds_dict, actual):
    names = list(preds_dict.keys())
    matrix = np.column_stack([preds_dict[m] for m in names])
    n = len(names)
    pop = [np.random.dirichlet(np.ones(n)) for _ in range(30)]
    best_w = pop[0]
    best_f = -np.mean(np.abs(actual - matrix @ best_w))
    for _ in range(20):
        scores = [(-np.mean(np.abs(actual - matrix @ w)), w) for w in pop]
        scores.sort(key=lambda x: -x[0])
        parents = [s[1] for s in scores[:15]]
        if scores[0][0] > best_f:
            best_f = scores[0][0]
            best_w = scores[0][1].copy()
        new_pop = parents[:]
        while len(new_pop) < 30:
            p1 = parents[np.random.randint(15)]
            p2 = parents[np.random.randint(15)]
            child = np.maximum(0.5 * p1 + 0.5 * p2 + np.random.normal(0, 0.05, n), 0)
            if child.sum() > 0:
                child /= child.sum()
            new_pop.append(child)
        pop = new_pop
    best_w = np.maximum(best_w, 0)
    best_w /= best_w.sum()
    return np.maximum(matrix @ best_w, 0), {
        m: round(float(w), 4) for m, w in zip(names, best_w)
    }


def run_forecast(df_demand, sku, verbose=True):
    series_raw = df_demand["Demand"].values.astype(float)
    dates = df_demand["Date"].reset_index(drop=True)
    promo_df = df_demand[
        ["IsPromo", "PromoDiscountPct", "PromoType"]
    ].reset_index(drop=True)

    adu_raw = float(np.mean(series_raw[series_raw > 0]))
    clean, rpt = clean_demand_adaptive(series_raw, dates, adu=adu_raw, verbose=verbose)

    n = len(clean)
    split = max(int(n * TRAIN_RATIO), 60)
    tr = clean[:split]
    te_clean = clean[split:]
    te_raw = clean[split:]
    tr_d = dates.iloc[:split].reset_index(drop=True)
    te_d = dates.iloc[split:].reset_index(drop=True)
    p_tr = promo_df.iloc[:split].reset_index(drop=True)
    p_te = promo_df.iloc[split : split + len(te_clean)].reset_index(drop=True)
    p_all = pd.concat([p_tr, p_te], ignore_index=True)
    nm = naive_mae(tr)
    n_te = len(te_raw)

    if verbose:
        print(f"\nTrain: {split} hari | Test: {n_te} hari | ADU: {np.mean(tr):.1f}")

    results = {}
    preds = {}

    def _add(tag, fn, info):
        try:
            p = fn()
            if p is not None:
                preds[tag] = p
                results[tag] = compute_metrics(te_raw, p, nm)
                results[tag]["Info"] = info
                if verbose:
                    print(f"  ✅ {tag:<28} MAE={results[tag]['MAE']:.1f}")
        except Exception as e:
            if verbose:
                print(f"  ❌ {tag:<28} {str(e)[:50]}")

    _add("M01-MA", lambda: forecast_ma(tr, n_te), "window=7")
    _add("M03-SES", lambda: forecast_ses(tr, n_te)[0], "auto-alpha")
    _add("M04-Holt", lambda: forecast_holt(tr, n_te)[0], "trend")
    _add("M05-HoltWinters", lambda: forecast_holtwinters(tr, n_te), "season=7")
    _add("M06-Croston", lambda: forecast_croston(tr, n_te), "intermittent")
    _add(
        "M11-EN+Promo",
        lambda: run_elasticnet(tr, te_clean, tr_d, te_d, p_all),
        "ElasticNet+Promo",
    )
    _add(
        "M18-HGB+Promo",
        lambda: run_hgb(tr, te_clean, tr_d, te_d, p_all),
        "HGB+Promo",
    )
    _add(
        "M07-RF+Promo",
        lambda: run_rf(tr, te_clean, tr_d, te_d, p_all),
        "RF+Promo",
    )
    _add(
        "M10-MLP+Promo",
        lambda: run_mlp(tr, te_clean, tr_d, te_d, p_all),
        "MLP+Promo",
    )
    _add(
        "M25-DOW-EN",
        lambda: run_dow_en(tr, te_clean, tr_d, te_d, p_all),
        "DOW-Segmented EN",
    )
    if len(preds) >= 4:
        _add(
            "M26-Ensemble-GA",
            lambda: run_ensemble_ga(preds, te_raw)[0],
            "GA-weighted ensemble",
        )

    df_cmp = pd.DataFrame([{"Model": m, **v} for m, v in results.items()])
    df_cmp = df_cmp.sort_values("MAE").reset_index(drop=True)
    df_cmp.insert(0, "Rank", range(1, len(df_cmp) + 1))
    best = df_cmp.iloc[0]["Model"]
    if verbose:
        print(f"\n{'='*55}")
        cols = ["Rank", "Model", "MAE", "Within10pct", "Within20pct", "MASE", "Bias"]
        cols = [c for c in cols if c in df_cmp.columns]
        print(df_cmp[cols].to_string(index=False))
        print(
            f"\n🏆 Terbaik: {best} | MAE={results[best]['MAE']} | "
            f"Error%={results[best]['MAE']/np.mean(tr)*100:.1f}%"
        )

    return {
        "sku": sku,
        "comparison": df_cmp,
        "best_model": best,
        "best_metrics": results[best],
        "predictions": preds,
        "actual_test": te_raw,
        "test_dates": te_d,
        "train_size": split,
        "series_clean": clean,
        "outlier_report": rpt,
        "adu": round(float(np.mean(clean[:split][clean[:split] > 0])), 2),
    }


def build_forecast_series_for_simulation(
    result_fc: dict,
    clean: np.ndarray,
    dlt: int = 0,
) -> np.ndarray:
    """
    Notebook RUN 3: SES in-sample for train; best model for test; Holt-Winters extend
    by DLT days for qualified-demand horizon.
    """
    best_model = result_fc["best_model"]
    train_size = result_fc["train_size"]
    fc_test = result_fc["predictions"][best_model]
    _, alpha_opt = forecast_ses(clean[:train_size], 1)
    s = float(clean[0])
    fc_train = np.zeros(train_size)
    for i in range(train_size):
        fc_train[i] = s
        s = alpha_opt * clean[i] + (1 - alpha_opt) * s
    rest = len(clean) - train_size
    fc = np.concatenate([fc_train, fc_test[:rest]])
    fc = np.maximum(fc[: len(clean)], 0)
    if dlt > 0:
        fc_extend = np.maximum(forecast_holtwinters(clean, int(dlt), season=7), 0)
        fc = np.concatenate([fc, fc_extend])
    return fc
