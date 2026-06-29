"""Genetic algorithm for VF/LTF with method-aware fitness."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd

from services.buffer_v2.common import LTF_GLOBAL_BOUNDS, VF_GLOBAL_BOUNDS, normalize_moq
from services.buffer_v2.selected_method import simulate_selected_method


def build_buffer(demands, vf: float, ltf: float, params: Dict[str, Any]) -> Dict[str, float]:
    demands = np.asarray(demands, dtype=float)
    dlt = max(int(params["dlt"]), 1)
    moq = normalize_moq(params.get("moq", 0), default=0)
    adu = float(np.mean(demands)) if len(demands) > 0 else 0.0
    bzr = adu * dlt * ltf
    tor = bzr * vf
    yellow = adu * dlt
    green = max(bzr, moq)
    toy = tor + yellow
    tog = toy + green
    return {
        "vf": float(vf),
        "ltf": float(ltf),
        "adu": float(adu),
        "bzr": float(bzr),
        "tor": float(tor),
        "yellow": float(yellow),
        "green": float(green),
        "toy": float(toy),
        "tog": float(tog),
    }


def fitness_buffer_ga_method_aware(
    vf: float,
    ltf: float,
    demands,
    dates,
    params: Dict[str, Any],
    cls: Dict[str, Any],
) -> Tuple[float, Dict[str, Any], Dict[str, float]]:
    buffer = build_buffer(demands, vf, ltf, params)
    kpi = simulate_selected_method(
        demands=demands,
        dates=dates,
        params=params,
        clf=cls,
        vf=vf,
        ltf=ltf,
        verbose=False,
    )
    total_cost = float(kpi["total_cost"])
    fill_rate = float(kpi["fill_rate"])
    csl = float(kpi["csl"])
    target_sl = float(params.get("target_sl", 0.95))

    service_penalty = 0.0
    if fill_rate < target_sl:
        service_penalty += (target_sl - fill_rate) * 1_000_000_000
    if csl < target_sl:
        service_penalty += (target_sl - csl) * 500_000_000

    return total_cost + service_penalty, kpi, buffer


def run_ga_buffer_optimization(
    demands,
    dates,
    params: Dict[str, Any],
    cls: Dict[str, Any],
    pop_size: int = 80,
    n_gen: int = 150,
    mutation_rate: float = 0.45,
    elite_size: int = 5,
    random_state: int = 42,
    verbose: bool = False,
) -> Dict[str, Any]:
    np.random.seed(random_state)
    vf_low, vf_high = VF_GLOBAL_BOUNDS
    ltf_low, ltf_high = LTF_GLOBAL_BOUNDS
    pop_size = max(int(pop_size), 4)
    n_gen = max(int(n_gen), 1)
    elite_size = max(1, min(int(elite_size), pop_size - 1))

    vf_init = float(np.clip(float(cls.get("vf_init", 0.50)), vf_low, vf_high))
    ltf_init = float(np.clip(float(cls.get("ltf_init", 0.50)), ltf_low, ltf_high))

    population: List[List[float]] = [[vf_init, ltf_init]]
    n_near_init = int(0.30 * pop_size)
    for _ in range(n_near_init):
        population.append(
            [
                float(np.clip(vf_init + np.random.normal(0, 0.15), vf_low, vf_high)),
                float(np.clip(ltf_init + np.random.normal(0, 0.15), ltf_low, ltf_high)),
            ]
        )
    while len(population) < pop_size:
        population.append(
            [float(np.random.uniform(vf_low, vf_high)), float(np.random.uniform(ltf_low, ltf_high))]
        )
    population_arr = np.array(population)

    best_solution = None
    best_fitness = np.inf
    best_kpi = None
    best_buffer = None
    history = []

    for gen in range(n_gen):
        evaluated = []
        for vf, ltf in population_arr:
            fitness, kpi, buffer = fitness_buffer_ga_method_aware(
                vf=float(vf),
                ltf=float(ltf),
                demands=demands,
                dates=dates,
                params=params,
                cls=cls,
            )
            evaluated.append({"vf": vf, "ltf": ltf, "fitness": fitness, "kpi": kpi, "buffer": buffer})
            if fitness < best_fitness:
                best_fitness = fitness
                best_solution = [float(vf), float(ltf)]
                best_kpi = kpi
                best_buffer = buffer

        evaluated.sort(key=lambda x: x["fitness"])
        best_gen = evaluated[0]
        history.append(
            {
                "generation": gen + 1,
                "best_fitness_generation": best_gen["fitness"],
                "best_vf_generation": best_gen["vf"],
                "best_ltf_generation": best_gen["ltf"],
                "best_total_cost_generation": best_gen["kpi"]["total_cost"],
            }
        )

        elites = evaluated[:elite_size]
        new_population = [[e["vf"], e["ltf"]] for e in elites]
        parent_pool = evaluated[: max(2, pop_size // 2)]
        vf_range = vf_high - vf_low
        ltf_range = ltf_high - ltf_low

        while len(new_population) < pop_size:
            p1 = parent_pool[np.random.randint(0, len(parent_pool))]
            p2 = parent_pool[np.random.randint(0, len(parent_pool))]
            alpha = np.random.rand()
            child_vf = alpha * p1["vf"] + (1 - alpha) * p2["vf"]
            child_ltf = alpha * p1["ltf"] + (1 - alpha) * p2["ltf"]
            if np.random.rand() < mutation_rate:
                child_vf += np.random.normal(0, 0.20 * vf_range)
            if np.random.rand() < mutation_rate:
                child_ltf += np.random.normal(0, 0.20 * ltf_range)
            new_population.append(
                [
                    float(np.clip(child_vf, vf_low, vf_high)),
                    float(np.clip(child_ltf, ltf_low, ltf_high)),
                ]
            )
        population_arr = np.array(new_population)

        if verbose:
            print(f"Gen {gen + 1:03d} fitness={best_fitness:,.0f} vf={best_solution[0]:.4f}")

    return {
        "vf_opt": best_solution[0],
        "ltf_opt": best_solution[1],
        "fitness": best_fitness,
        "kpi": best_kpi,
        "buffer": best_buffer,
        "history": pd.DataFrame(history),
    }
