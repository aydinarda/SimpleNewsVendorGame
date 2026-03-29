import { describeDistribution } from "../utils/demand";

function PricesDetail({ prices }) {
  if (!prices) return null;
  return (
    <div className="prices-detail">
      <span>Retail Price: <strong>${prices.retailPrice}</strong></span>
      <span>Wholesale Cost: <strong>${prices.wholesaleCost}</strong></span>
      <span>Salvage Price: <strong>${prices.salvagePrice}</strong></span>
    </div>
  );
}

function DistributionDetail({ distribution }) {
  if (distribution.type === "normal") {
    return (
      <div className="distribution-detail">
        <span className="dist-type">Normal Distribution</span>
        <span>Mean (μ): <strong>{distribution.mean}</strong></span>
        <span>Std. Deviation (σ): <strong>{distribution.stdDev}</strong></span>
      </div>
    );
  }

  return (
    <p className="muted">Distribution: {describeDistribution(distribution)}</p>
  );
}

function RoundInfo({ round, totalRounds, prices }) {
  return (
    <section className="card">
      <p className="eyebrow">Round {round.id} / {totalRounds}</p>
      <h2>{round.title}</h2>
      <PricesDetail prices={prices} />
      <DistributionDetail distribution={round.distribution} />
    </section>
  );
}

export default RoundInfo;
