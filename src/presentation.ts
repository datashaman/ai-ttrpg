import type {
  CanonicalEvent,
  CheckTrace,
  EstablishedFact,
  OracleTrace,
} from "./structured-play.js";
import {
  immutableSnapshot,
  invokeWithinTimeout,
  isRecord,
} from "./model-boundary.js";

export type ResolutionTrace = CheckTrace | OracleTrace | null;

export interface NarrationRequest {
  readonly visibleEvidence: readonly EstablishedFact[];
  readonly resolutionTrace: ResolutionTrace;
  readonly committedEvents: readonly CanonicalEvent[];
}

export interface PresentationContext extends NarrationRequest {
  readonly deterministicSummary: string;
}

export interface RulesQueryRequest extends NarrationRequest {
  readonly query: string;
}

export interface PresentationCitation {
  readonly kind: "evidence" | "event" | "rule";
  readonly id: string;
}

export interface GroundedPresentation {
  readonly segments: readonly PresentationCitation[];
}

export interface PresentationModel {
  narrate(request: NarrationRequest): Promise<unknown>;
  explainRules(request: RulesQueryRequest): Promise<unknown>;
}

export interface PresentedText {
  readonly source: "model" | "deterministic-fallback";
  readonly text: string;
}

const isCitation = (value: unknown): value is PresentationCitation =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  (value.kind === "evidence" || value.kind === "event" || value.kind === "rule") &&
  typeof value.id === "string";

const ruleIdFrom = (trace: ResolutionTrace): string | null =>
  trace === null ? null : `${trace.rule.id}@${trace.rule.version}`;

const validatesAgainst = (
  value: unknown,
  request: NarrationRequest,
): value is GroundedPresentation => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    !value.segments.every(isCitation)
  ) {
    return false;
  }

  const evidenceIds = new Set(request.visibleEvidence.map((fact) => fact.id));
  const eventIds = new Set(request.committedEvents.map((event) => event.id));
  const ruleId = ruleIdFrom(request.resolutionTrace);
  return value.segments.every((citation) => {
    if (citation.kind === "evidence") return evidenceIds.has(citation.id);
    if (citation.kind === "event") return eventIds.has(citation.id);
    return citation.id === ruleId;
  });
};

export const createPresentationContext = (
  context: PresentationContext,
): PresentationContext => immutableSnapshot(context);

const requestFrom = (context: PresentationContext): NarrationRequest =>
  immutableSnapshot({
    visibleEvidence: context.visibleEvidence,
    resolutionTrace: context.resolutionTrace,
    committedEvents: context.committedEvents,
  });

const renderRule = (trace: ResolutionTrace): string | null => {
  if (trace === null) return null;
  if (trace.rule.id === "micro-ruleset.check" && "total" in trace.result) {
    return `${trace.rule.id}@${trace.rule.version}: total ${trace.result.total} resolved as ${trace.result.outcome}.`;
  }
  if (trace.rule.id === "micro-ruleset.oracle" && "roll" in trace.result) {
    return `${trace.rule.id}@${trace.rule.version}: roll ${trace.result.roll} against ${trace.result.yesThreshold}% resolved ${trace.result.answer}.`;
  }
  return null;
};

const render = (
  presentation: GroundedPresentation,
  context: PresentationContext,
): string => {
  const evidence = new Map(
    context.visibleEvidence.map((fact) => [fact.id, fact.text]),
  );
  const eventIds = new Set(context.committedEvents.map((event) => event.id));
  const ruleId = ruleIdFrom(context.resolutionTrace);
  const ruleText = renderRule(context.resolutionTrace);
  const rendered = presentation.segments.flatMap((segment) => {
    if (segment.kind === "evidence") {
      const text = evidence.get(segment.id);
      return text === undefined ? [] : [text];
    }
    if (segment.kind === "event") {
      return eventIds.has(segment.id) ? [context.deterministicSummary] : [];
    }
    return segment.id === ruleId && ruleText !== null ? [ruleText] : [];
  });
  return [...new Set(rendered)].join(" ");
};

const present = async (
  invocation: (request: NarrationRequest) => Promise<unknown>,
  context: PresentationContext,
  timeoutMs: number,
): Promise<PresentedText> => {
  const request = requestFrom(context);
  try {
    const response = await invokeWithinTimeout(
      () => invocation(request),
      timeoutMs,
    );
    if (!validatesAgainst(response, request)) {
      return {
        source: "deterministic-fallback",
        text: context.deterministicSummary,
      };
    }
    const text = render(response, context);
    return text === ""
      ? { source: "deterministic-fallback", text: context.deterministicSummary }
      : { source: "model", text };
  } catch {
    return {
      source: "deterministic-fallback",
      text: context.deterministicSummary,
    };
  }
};

export const narrateCommittedOutcome = (
  model: PresentationModel,
  context: PresentationContext,
  timeoutMs: number,
): Promise<PresentedText> =>
  present((request) => model.narrate(request), context, timeoutMs);

export const explainCommittedRules = (
  model: PresentationModel,
  context: PresentationContext,
  query: string,
  timeoutMs: number,
): Promise<PresentedText> => {
  const request = requestFrom(context);
  const rulesRequest = immutableSnapshot({ ...request, query });
  return present(
    () => model.explainRules(rulesRequest),
    context,
    timeoutMs,
  );
};
