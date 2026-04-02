import numpy as np
import pandas as pd
import math

VF_SPACE  = {'SMOOTH':(0.10,0.30),'ERRATIC':(0.25,0.55),
             'INTERMITTENT':(0.30,0.65),'LUMPY':(0.55,1.00)}
LTF_SPACE = {'SHORT':(0.61,1.00),'MEDIUM':(0.41,0.60),'LONG':(0.20,0.40)}

def classify_sku(series, dlt):
    """Calculate ADI, CV2 to pick category bounds"""
    nz = series[series>0]
    n = len(series)
    k = len(nz)
    adu = float(np.mean(series)) if n > 0 else 0
    if k == 0: return 'SMOOTH', 0, 0
    
    adi = n / k
    mean_nz = np.mean(nz)
    cv2 = float((np.std(nz, ddof=1)/mean_nz)**2) if k>1 and mean_nz>0 else 0.0
    
    if adi <= 1.32 and cv2 <= 0.49: cat = 'SMOOTH'
    elif adi <= 1.32 and cv2 > 0.49: cat = 'ERRATIC'
    elif adi > 1.32 and cv2 <= 0.49: cat = 'INTERMITTENT'
    else: cat = 'LUMPY'
    return cat, adi, cv2

def simulate_ddmrp(demands, vf, ltf, dlt, pack_size, hold_cost_rate, order_cost, penalty_mult):
    n = len(demands)
    adu = float(np.mean(demands))
    bzr = adu * dlt * ltf
    tor = bzr * vf
    toy = tor + adu * dlt
    tog = toy + max(bzr, pack_size)
    
    oh = toy
    pipeline = {}
    total_unmet = 0
    total_order = 0
    total_hold = 0
    total_shipped = 0
    
    for t in range(n):
        receipt = float(pipeline.pop(t, 0.0))
        oh += receipt
        op = sum(float(q) for d, q in pipeline.items() if 1 <= (d - t) <= dlt)
        
        # Simple QD without forecast lookahead
        qd = float(demands[t])
        nfe = oh + op - qd
        
        q = 0
        if nfe <= toy:
            q = int(max((tog - nfe, pack_size)))
        if q > 0:
            pipeline[t + dlt] = pipeline.get(t + dlt, 0.0) + float(q)
            total_order += order_cost
            
        dem = float(demands[t])
        shipped = min(dem, oh)
        unmet = max(dem - shipped, 0.0)
        oh -= shipped
        
        total_unmet += unmet
        total_shipped += shipped
        total_hold += oh * hold_cost_rate
        
    cost = total_hold + total_order + (total_unmet * penalty_mult)
    fr = total_shipped / float(sum(demands)) if sum(demands) > 0 else 1.0
    return {"total_cost": cost, "fill_rate": fr, "tor": tor, "toy": toy, "tog": tog}

class GeneticOptimizer:
    def __init__(self, vf_bounds, ltf_bounds, sl_target=0.95, pop_size=20, n_gen=20):
        self.vf_b = vf_bounds
        self.ltf_b = ltf_bounds
        self.sl = sl_target
        self.ps = pop_size
        self.ng = n_gen
        self.best = None
        self.best_fit = -np.inf

    def _fit(self, ind, sim_fn):
        kpi = sim_fn(vf=ind[0], ltf=ind[1])
        pen = kpi['total_cost'] * (self.sl - kpi['fill_rate']) * 50 if kpi['fill_rate'] < self.sl else 0
        return -(kpi['total_cost'] + pen)
        
    def run(self, sim_fn, vf_init, ltf_init):
        pop = [np.array([np.random.uniform(*self.vf_b), np.random.uniform(*self.ltf_b)]) for _ in range(self.ps)]
        
        for gen in range(self.ng):
            scores = [self._fit(ind, sim_fn) for ind in pop]
            bi = int(np.argmax(scores))
            if scores[bi] > self.best_fit:
                self.best_fit = scores[bi]
                self.best = pop[bi].copy()
                
            idx = np.argsort(scores)[::-1]
            parents = [pop[i].copy() for i in idx[:self.ps//2]]
            new_pop = parents[:max(2, int(self.ps*0.2))]
            
            while len(new_pop) < self.ps:
                p1, p2 = parents[np.random.randint(len(parents))], parents[np.random.randint(len(parents))]
                c = np.where(np.random.rand(2) < 0.5, p1, p2)
                c[0] = np.clip(c[0] + np.random.normal(0, 0.05), *self.vf_b)
                c[1] = np.clip(c[1] + np.random.normal(0, 0.05), *self.ltf_b)
                new_pop.append(c)
            pop = new_pop[:self.ps]
            
        kpi = sim_fn(vf=self.best[0], ltf=self.best[1])
        return {
            'fv_opt': float(self.best[0]),
            'ltf_opt': float(self.best[1]),
            'fill_rate': kpi['fill_rate'],
            'total_cost': kpi['total_cost'],
            'tor': kpi['tor'],
            'toy': kpi['toy'],
            'tog': kpi['tog']
        }

def execute_optimization(sku: str, demands: list, dlt: int, pack_size: int, hold_cost_rate: float, order_cost: float, penalty_mult: float, sl_target=0.95):
    cat, adi, cv2 = classify_sku(np.array(demands), dlt)
    lt_cat = 'SHORT' if dlt<=10 else ('MEDIUM' if dlt<=25 else 'LONG')
    
    vf_bounds = VF_SPACE.get(cat, (0.1, 1.0))
    ltf_bounds = LTF_SPACE.get(lt_cat, (0.2, 1.0))
    
    vf_init = sum(vf_bounds)/2
    ltf_init = sum(ltf_bounds)/2
    
    sim_fn = lambda vf, ltf: simulate_ddmrp(
        np.array(demands), vf, ltf, dlt, pack_size, hold_cost_rate, order_cost, penalty_mult
    )
    
    opt = GeneticOptimizer(vf_bounds, ltf_bounds, sl_target=sl_target)
    res = opt.run(sim_fn, vf_init, ltf_init)
    
    res['sku'] = sku
    res['category'] = cat
    res['adi'] = adi
    res['cv2'] = cv2
    return res
