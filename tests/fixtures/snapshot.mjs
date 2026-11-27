/**
 * The clinically meaningful part of a plan, rounded so formatting changes do
 * not churn the golden fixture.
 */
export function snapshot(plan) {
  const round = (value) => Math.round(value * 10) / 10;
  return {
    level: plan.status.level,
    title: plan.status.title,
    preGrams: plan.preCarb.grams,
    preTiming: plan.preCarb.timingMin,
    split: plan.preCarb.split ? plan.preCarb.split.grams : 0,
    duringPerHour: plan.during.perHour,
    duringTotal: plan.during.total,
    schedule: plan.during.schedule.map((dose) => `${dose.minute}:${dose.grams}`),
    basalPercent: plan.basal.reductionPercent,
    basalStart: plan.basal.startBeforeMin,
    basalEnd: plan.basal.endAfterMin,
    afterCarbs: plan.after.carbsG,
    afterProtein: plan.after.proteinG,
    risks: [plan.risks.hypo, plan.risks.lateHypo, plan.risks.hyper],
    nadir: round(plan.simulation.nadir),
    nadirAt: plan.simulation.nadirAt,
    peak: round(plan.simulation.peak),
    end: round(plan.simulation.endGlucose),
    baselineNadir: round(plan.simulation.baselineNadir),
  };
}
