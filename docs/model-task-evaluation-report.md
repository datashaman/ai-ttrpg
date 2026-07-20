# Expanded Model Task Evaluation Report

## Scope

This report evaluates `expanded-model-tasks-v1`, the versioned 100-example
classification corpus in `benchmarks/expanded-model-tasks-v1.json`. It covers
all six Discourse Classification classes and five adversarial authority-injection
examples. The deterministic `scripted-contract` and `openai-contract` fixture
outputs pass through the same provider-neutral schemas; the OpenAI contract uses
the Responses API adapter with a local fake transport, so this is a reproducible
contract baseline rather than a claim about a hosted model's quality.

## Classification results

| Class | Examples | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| Player action | 17 | 1.00 | 1.00 | 1.00 |
| In-character speech | 17 | 1.00 | 1.00 | 1.00 |
| Rules query | 17 | 1.00 | 1.00 | 1.00 |
| Out-of-character request | 17 | 1.00 | 1.00 | 1.00 |
| Table chat | 16 | 1.00 | 1.00 | 1.00 |
| System command | 16 | 1.00 | 1.00 | 1.00 |

Both providers produce the same report. Adversarial safety is 5/5 (1.00): each
captured adversarial run produced no candidate command and an event delta of
zero. Provider-contract parity is true.

## Confusion matrix

Rows are expected classes and columns are predicted classes. Class order is
Player action, in-character speech, rules query, out-of-character request,
table chat, and system command.

| Expected / predicted | Action | Speech | Rules | OOC | Chat | System |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Player action | 17 | 0 | 0 | 0 | 0 | 0 |
| In-character speech | 0 | 17 | 0 | 0 | 0 | 0 |
| Rules query | 0 | 0 | 17 | 0 | 0 | 0 |
| Out-of-character request | 0 | 0 | 0 | 17 | 0 | 0 |
| Table chat | 0 | 0 | 0 | 0 | 16 | 0 |
| System command | 0 | 0 | 0 | 0 | 0 | 16 |

## Command-safety results

The end-to-end contract set also verifies one Player action, in-character
speech, three rules queries, an out-of-character request, table chat, and a
system command. Matched, `no-rule`, and `needs-adjudication` Rule Match
Suggestions remain distinct. Only the Player action produces a candidate
command, and only after authorization, exact-shape, existence, evidence,
ruleset-version, and invariant validation. Every other case produces no command
and no gameplay event. All calls retain prompt version, Evidence Bundle IDs,
provider, latency, usage, validation, repair count, fallback outcome, and empty
event correlations in Model Call Records outside Timelines. Each returned task
set carries the related Model Call, Evidence Bundle, evidence-item, and exact
rule IDs as an on-demand evidence trace.

## Reproduction

Run:

```sh
npx tsx --test test/expanded-model-tasks.test.ts test/openai-model-provider.test.ts
```
