"""Synthetic student bench (scripts/simulate.py): the pipeline must recover known levels."""
import simulate


def test_levels_are_recovered_from_simulated_evidence():
    r = simulate.run(n=150, seed=11)
    assert r["within_one"] >= 0.95, r
    assert r["exact"] >= 0.70, r
    assert r["mean_items"] <= 8, r


def test_self_report_bias_does_not_decide_the_level():
    r = simulate.run(n=150, seed=12)
    rates = r["exact_by_self_report_bias"]
    # Students who under-claim must be recovered about as well as those who over-claim.
    assert abs(rates["under"] - rates["over"]) < 0.1, rates
