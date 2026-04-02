import pandas as pd
import numpy as np
from scipy.optimize import minimize
from sklearn.linear_model import ElasticNet
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import MinMaxScaler
import warnings

warnings.filterwarnings('ignore')

# ── Metrics ──
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
    return {'MAE': round(mae,2), 'RMSE': round(rmse,2), 'MAPE': round(mape,2) if not np.isnan(mape) else None}

def naive_mae(train):
    return float(np.mean(np.abs(np.diff(train)))) if len(train)>1 else 1.0

# ── Clean Demand ──
def clean_demand_adaptive(series, dates, adu=None, low_pct=0.02):
    series = np.array(series, dtype=float)
    if adu is None:
        adu = np.mean(series[series>0]) if len(series[series>0]) > 0 else 0
    low_thr = adu * low_pct
    nz = series[series>0]
    if len(nz) > 0:
        Q1, Q3 = np.percentile(nz, 25), np.percentile(nz, 75)
        high_thr = Q3 + 2.0*(Q3-Q1)
    else:
        high_thr = adu
    mask = (series < low_thr) | (series > high_thr)
    cleaned = series.copy()
    for i in np.where(mask)[0]:
        lo = max(0, i-7); hi = min(len(series), i+8)
        nbrs = series[lo:hi]
        valid = nbrs[(nbrs>=low_thr)&(nbrs<=high_thr)]
        if len(valid) >= 3:
            cleaned[i] = np.median(valid)
        elif len(nz) > 0:
            cleaned[i] = np.median(nz[(nz>=low_thr)&(nz<=high_thr)])
    return cleaned

# ── Statistical Models ──
def forecast_ses(train, n):
    def mse(a):
        s=train[0]; e=0
        for v in train[1:]: e+=(v-s)**2; s=a[0]*v+(1-a[0])*s
        return e
    res = minimize(mse,[0.3],bounds=[(0.01,0.99)],method='L-BFGS-B')
    alpha = float(res.x[0])
    s = train[0] if len(train)>0 else 0
    for v in train[1:]: s=alpha*v+(1-alpha)*s
    return np.full(n, max(s,0))

def forecast_croston(train, n, alpha=0.1):
    nz = np.where(train>0)[0]
    if len(nz)<2: return np.full(n, np.mean(train) if len(train)>0 else 0)
    z = float(train[nz[0]]); p = float(nz[0]+1); q = 0
    for t in range(1,len(train)):
        q += 1
        if train[t]>0: z=alpha*train[t]+(1-alpha)*z; p=alpha*q+(1-alpha)*p; q=0
    return np.full(n, max(z/p if p > 0 else 0, 0))

# ── Feature Engineering ──
def make_features(all_series, all_dates, all_promo_pct, all_ispromo):
    df = pd.DataFrame({'y': all_series, 'date': pd.to_datetime(all_dates)})
    y_s = df['y'].shift(1)
    for lag in [1,7,14]:
        df[f'lag_{lag}'] = df['y'].shift(lag)
    for w in [7,14]:
        df[f'rm_{w}'] = y_s.rolling(w, min_periods=3).mean()
    df['dow'] = df['date'].dt.dayofweek
    df['is_weekend'] = (df['dow'] >= 5).astype(int)
    
    promo_arr = np.array(all_ispromo, dtype=int)
    disc_arr = np.array(all_promo_pct, dtype=float)
    df['is_promo'] = promo_arr
    df['promo_discount'] = disc_arr
    return df.drop(columns=['date'])

def split_xy(all_series, tr_d, te_d, promo_df, n_train):
    all_dates = pd.concat([tr_d, te_d], ignore_index=True)
    all_promo = pd.concat([promo_df.iloc[:n_train], promo_df.iloc[n_train:]], ignore_index=True)
    df = make_features(all_series, all_dates, all_promo['PromoDiscountPct'].values, all_promo['IsPromo'].astype(int).values)
    df['y'] = all_series
    fcols = [c for c in df.columns if c!='y']
    df_tr = df.iloc[:n_train].dropna()
    df_te = df.iloc[n_train:].copy()
    for col in fcols:
        if df_te[col].isna().any():
            df_te[col] = df_te[col].fillna(df_tr[col].mean() if not df_tr.empty else 0)
    return df_tr[fcols], df_tr['y'], df_te[fcols]

# ── ML Models ──
def run_rf(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr,te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    if X_tr.empty: return np.zeros(len(te))
    m = RandomForestRegressor(n_estimators=50, max_depth=8, random_state=42)
    m.fit(X_tr, y_tr)
    return np.maximum(m.predict(X_te), 0)

def run_elasticnet(tr, te, tr_d, te_d, promo_df):
    all_s = np.concatenate([tr,te])
    X_tr, y_tr, X_te = split_xy(all_s, tr_d, te_d, promo_df, len(tr))
    if X_tr.empty: return np.zeros(len(te))
    sx = MinMaxScaler()
    m = ElasticNet(alpha=0.1, l1_ratio=0.5, max_iter=1000)
    m.fit(sx.fit_transform(X_tr), y_tr)
    return np.maximum(m.predict(sx.transform(X_te)), 0)

# ── Ensemble GA ──
def run_ensemble_ga(preds_dict, actual):
    names = list(preds_dict.keys())
    matrix = np.column_stack([preds_dict[m] for m in names])
    n = len(names)
    pop = [np.random.dirichlet(np.ones(n)) for _ in range(20)]
    best_w = pop[0]
    best_f = -np.mean(np.abs(actual - matrix@best_w))
    for _ in range(10):
        scores = [(-np.mean(np.abs(actual - matrix@w)), w) for w in pop]
        scores.sort(key=lambda x: -x[0])
        parents = [s[1] for s in scores[:10]]
        if scores[0][0] > best_f:
            best_f = scores[0][0]; best_w = scores[0][1].copy()
        new_pop = parents[:]
        while len(new_pop) < 20:
            c = np.maximum(0.5*parents[np.random.randint(10)] + 0.5*parents[np.random.randint(10)] + np.random.normal(0,0.05,n), 0)
            if c.sum()>0: c/=c.sum()
            new_pop.append(c)
        pop = new_pop
    return np.maximum(matrix@best_w, 0), best_w

# ── Main Runner ──
def execute_forecast_pipeline(df_demand, sku, horizon=30):
    """
    df_demand requires columns: Date, Demand, IsPromo, PromoDiscountPct
    """
    if df_demand.empty: return {"sku": sku, "error": "No data"}
    df_demand = df_demand.sort_values('Date').reset_index(drop=True)
    
    series_raw = df_demand['Demand'].values.astype(float)
    dates = df_demand['Date'].reset_index(drop=True)
    promo_df = df_demand[['IsPromo','PromoDiscountPct']].copy()
    
    # Assume we forecast next `horizon` days
    future_dates = pd.date_range(start=dates.max() + pd.Timedelta(days=1), periods=horizon, freq='D')
    
    clean = clean_demand_adaptive(series_raw, dates)
    
    # Normally we do train/test split. For API execution of future, we fit on ALL data
    tr = clean
    te = np.zeros(horizon) # Dummy for future
    
    tr_d = dates
    te_d = pd.Series(future_dates)
    
    # Future promos assumed 0 for simplicity if not provided
    p_tr = promo_df
    p_te = pd.DataFrame({'IsPromo': [False]*horizon, 'PromoDiscountPct': [0.0]*horizon})
    p_all = pd.concat([p_tr, p_te], ignore_index=True)
    
    preds = {}
    preds['SES'] = forecast_ses(tr, horizon)
    preds['Croston'] = forecast_croston(tr, horizon)
    preds['RF'] = run_rf(tr, te, tr_d, te_d, p_all)
    preds['ElasticNet'] = run_elasticnet(tr, te, tr_d, te_d, p_all)
    
    # Just return RF for simple API response since we don't have true 'actual test' to ensemble on for the FUTURE.
    # We would use simple average
    ensemble = sum(preds.values()) / len(preds)
    
    return {
        "sku": sku,
        "forecast_dates": [d.strftime('%Y-%m-%d') for d in future_dates],
        "ensemble_forecast": ensemble.round(2).tolist(),
        "models": {k: v.round(2).tolist() for k, v in preds.items()}
    }
