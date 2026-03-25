import { describeDistribution } from "../utils/demand";

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

function RoundInfo({ round, totalRounds }) {
  return (
    <section className="card">
      <p className="eyebrow">Round {round.id} / {totalRounds}</p>
      <h2>{round.title}</h2>
      <DistributionDetail distribution={round.distribution} />
    </section>
  );
}

export default RoundInfo;
