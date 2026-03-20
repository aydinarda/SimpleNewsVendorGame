import { describeDistribution } from "../utils/demand";

function RoundInfo({ round, totalRounds }) {
  return (
    <section className="card">
      <p className="eyebrow">Round {round.id} / {totalRounds}</p>
      <h2>{round.title}</h2>
      <p className="muted">Demand distribution: {describeDistribution(round.distribution)}</p>
    </section>
  );
}

export default RoundInfo;
