import type { PlayerEvidenceItem } from "../../src/player-ui/application-client.js";

export const EvidenceTrace = ({
  evidence,
  modelCallIds,
  evidenceBundleIds,
  bundleItemIds,
  citedEvidenceItemIds,
  ruleIds,
  summary = "Inspect interpretation evidence",
}: {
  readonly evidence: readonly PlayerEvidenceItem[];
  readonly modelCallIds: readonly string[];
  readonly evidenceBundleIds: readonly string[];
  readonly bundleItemIds: readonly string[];
  readonly citedEvidenceItemIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly summary?: string;
}) => (
  <details className="input-evidence">
    <summary>{summary}</summary>
    <div className="trace">
      {evidenceBundleIds.map((id) => (
        <p key={id}><strong>Evidence Bundle</strong> <code>{id}</code></p>
      ))}
      {modelCallIds.map((id) => (
        <p key={id}><strong>Model Call</strong> <code>{id}</code></p>
      ))}
      {ruleIds.map((id) => (
        <p key={id}><strong>Approved rule cited</strong> <code>{id}</code></p>
      ))}
      <ul>
        {evidence.map((item) => (
          <li key={item.id}>
            <strong>{citedEvidenceItemIds.includes(item.id) ? "Cited support" : bundleItemIds.includes(item.id) ? "Supplied context" : item.sourceKind}</strong> — {item.content}
            <span>{item.inclusionReason}</span>
            {item.citation === null ? null : <code>Citation: {item.citation}</code>}
          </li>
        ))}
      </ul>
    </div>
  </details>
);
