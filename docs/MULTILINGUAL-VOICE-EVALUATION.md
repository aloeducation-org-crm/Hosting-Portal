# Multilingual Voice Evaluation

**Status: PLANNED — NOT IMPLEMENTED, AND NO QUALITY CLAIM IS MADE.**

A repository-wide search found **no** speech pipeline: no VAD, no ASR, no TTS, no
language identification, no audio handling. The strings `bangla`, `bn-BD`, `TTS`
and `ASR` appear only inside the self-hosted AI *catalogue*
(`src/lib/ai/self-hosted-agents.ts`), the provider list
(`src/lib/ai/providers.ts`) and marketing copy (`src/lib/marketing/suite.ts`).
Those are descriptions of third-party software, not an implementation.

**Nobody may claim natural Bangladeshi voice quality from this repository.** Such
a claim requires recorded samples and native-speaker evaluation, recorded in §7.
Neither exists.

---

## 1. Requirements

Priority languages, in order:

| Language | Tag | Notes |
| --- | --- | --- |
| Bangla | `bn-BD` | Bangladeshi pronunciation and conversational style, not a West Bengal reading of written Bangla |
| English | `en` | Interface and fallback |
| Hindi | `hi-IN` | |
| Arabic | `ar` | RTL text handling in any transcript UI |

Extensible: adding a language must be configuration plus a model, not a code
change in the pipeline.

Non-negotiable constraints carried over from the platform rules:

- **Inference runs locally or on infrastructure the operator controls.** A paid
  external speech API may be an *option*, disabled by default, and core operation
  must not require it.
- No audio, transcript or derived embedding leaves the controlled boundary
  without an explicit, recorded decision.
- Recording requires consent, and consent state must be stored per call.

---

## 2. Pipeline

```
audio in
  → VAD              (is anyone speaking; where are the utterance boundaries)
  → ASR              (speech → text, with per-token confidence)
  → LID              (which language, per utterance; allow switches mid-call)
  → authorization    (who is this actor, which tenant, which records may be used)
  → context/memory   (bounded retrieval — see AI-MEMORY-ARCHITECTURE.md)
  → local LLM        (response, with tool calls only through the existing allowlist)
  → TTS              (text → speech, target language)
  → audio out
```

Cross-cutting requirements:

- **Streaming where the model supports it**, so latency is not the sum of every
  stage.
- **Barge-in**: when the user starts speaking, cancel synthesis immediately and
  stop the in-flight generation. A voice assistant that talks over the user is
  unusable on a support call.
- **Low-confidence recovery**: below a confidence threshold the system must ask
  for a repetition or offer a human handoff — it must not guess and continue.
- **Graceful fallback**: if TTS is unavailable, the conversation continues in
  text; if ASR is unavailable, the call is offered a human, not silence.
- **Language switching**: an utterance in English inside a Bangla call must not
  force the whole call to switch, and a deliberate switch must be honoured.
- **Human handoff** must be reachable at any point, and the handoff must carry the
  transcript so the caller does not repeat themselves.
- **Modularity**: telephony, inference and application are separate processes, so
  one failing cannot corrupt CRM data.

The AI layer must never gain telephony control: no SIP management, no unrestricted
call control, no direct access to recordings. It receives transcripts and emits
text; the telephony subsystem acts, under its own authorization.

---

## 3. Candidate components (to be evaluated, not selected)

Selection must be made against the **actual hardware** — Office A (16 GB, no GPU
confirmed), Office B (8 GB) and Hostinger Cloud (4 GB, production, must not run
inference) — and against licences. Nothing below has been installed, run,
benchmarked or licensed-checked in this repository.

| Stage | Options to evaluate | What to check |
| --- | --- | --- |
| VAD | energy-based; `webrtcvad`; `silero-vad` | licence; CPU cost per stream; false-trigger rate in office noise |
| ASR (Bangla) | `whisper` family (small/medium/large), `faster-whisper`, `Vosk` (bn model), `Coqui STT` | **Bangla WER on Bangladeshi speech**, code-switching, numbers/dates/currency, licence, RAM and CPU per concurrent stream |
| LID | `whisper` language detection; `speechbrain` lang-id | accuracy on short utterances; bn vs hi confusion |
| LLM | whatever the existing local provider chain already resolves | must reuse `src/lib/ai/providers.ts`; no new mandatory service |
| TTS (Bangla) | `Piper` (bn voices), `Coqui TTS`/`XTTS`, `eSpeak NG` (intelligible but robotic), `MeloTTS`, `Kokoro` | **native-speaker intelligibility and naturalness for bn-BD**, whether a bn-BD voice exists at all, licence, latency to first audio |
| Telephony | Asterisk, FreeSWITCH | only after the current codebase and operational requirements are verified; SIP must not be exposed to the AI layer |

Two honest risks that decide feasibility before any model comparison:

1. **A good bn-BD TTS voice may not exist in the locally runnable options.** If
   evaluation confirms that, the choices are (a) accept a lower-quality voice and
   say so, (b) train/fine-tune one, which needs recorded consented data and
   significant effort, or (c) offer text for Bangla and voice for English. None
   of those may be presented as "natural Bangladeshi voice".
2. **Concurrent streams on CPU-only hardware are limited.** Measure seconds of
   audio processed per wall-clock second per core, then decide how many
   simultaneous calls the office servers can carry. Do not size this from a
   single-stream demo.

---

## 4. Bangla-specific evaluation criteria

Recorded per candidate, per criterion, with the sample set version:

| Criterion | How it is measured | Pass bar (to be agreed before testing) |
| --- | --- | --- |
| Bangladeshi pronunciation | native-speaker rating of synthesized samples, blind, 1–5 | mean ≥ 4.0, no sample < 3.0 |
| Dialect familiarity | same raters judge whether it sounds like Dhaka speech vs a written/West Bengal reading | majority "Bangladeshi" |
| Intelligibility of ASR output | WER on a Bangladeshi test set read aloud by ≥ 5 speakers | report WER; set the bar after the first measurement, not before |
| Code-switching | utterances mixing Bangla and English ("আমার domain টা renew করতে হবে") | mixed utterances transcribed without language collapse |
| Names, dates, currency, phone numbers, addresses | a fixed list of real-shaped values | exact-match rate reported per category |
| Business terminology | ALO Education / hosting domain terms | glossary-driven exact match |
| Background noise | same set re-recorded at office noise levels | degradation reported, not hidden |
| Turn-taking | measured silence between user finishing and assistant starting | p95 reported |
| Latency | time from end of utterance to first audio out | p50/p95 reported |
| Barge-in | time from user speech onset to synthesis stopping | must stop; measured |
| Low-confidence recovery | deliberately mumbled/noisy input | asks to repeat or offers handoff; never fabricates |

Test data must be consented, stored inside the controlled boundary, and deletable.
Raters must be native Bangladeshi Bangla speakers, and their ratings must be
recorded with the sample identifier so a claim can be re-checked.

---

## 5. Privacy and consent

- Recording only with consent; consent state stored per call and retrievable.
- Transcripts are personal data: tenant-scoped, retention-limited, deletable.
- Audio is not retained longer than the evaluation or the business need requires;
  the default is to keep the transcript and discard the audio.
- Nothing is sent to an external API unless the operator explicitly enabled it,
  and enabling it is recorded in the audit log.
- Redaction applies before storage: the existing `redact()` path already strips
  tokens, keys, private-key bodies, database URLs and `password=` values, and
  transcripts must go through it.

---

## 6. Integration points that already exist

| Need | Existing component |
| --- | --- |
| Model routing, local-first | `src/lib/ai/providers.ts`, `src/lib/ai/client.ts` |
| Durable background work (transcription jobs, retries) | `src/lib/orchestrator/` |
| Tool safety | orchestrator risk levels + agent allowlist; a voice assistant gets **no** extra capability |
| Audit | `src/lib/audit.ts` |
| CRM records to attach a call to | `CrmContact`, `CrmDeal`, pipelines, activities (present, **not audited**) |
| Secret handling | `src/lib/encryption.ts`, `src/lib/deploy/redact.ts` |

New surface should be a separate service (telephony + audio) that talks to the
panel through the existing authenticated API, so that a crash in audio processing
cannot corrupt CRM data.

---

## 7. Evaluation record (empty — nothing has been run)

| Candidate | Stage | Hardware | Licence | Bangla result | Latency | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | not evaluated |

**Native-speaker sessions:** none held.
**Recorded samples:** none.
**Reproducible test harness:** does not exist yet.

Until this table has rows, every statement about voice quality in any report,
UI or marketing surface must read *not evaluated*.

---

## 8. Order of work

1. Confirm hardware reality on Office A and Office B (CPU, RAM, whether a GPU
   exists) with `scripts/server-doctor.sh` and the audit script — no model choice
   before this.
2. Build a reproducible Bangla evaluation harness (fixed sample set, WER scoring,
   blind rating sheets) **before** trying any model, so results are comparable.
3. Evaluate ASR candidates; record WER and code-switching behaviour.
4. Evaluate TTS candidates; hold the native-speaker session; record ratings.
5. Only if both pass: integrate VAD + ASR + TTS behind a feature flag, text-first
   fallback always available.
6. Then and only then consider telephony (Asterisk/FreeSWITCH), with SIP isolated
   from the AI layer.
