# Sahaay Voice — Product and Engineering Requirements

## 1. Document purpose

This document is the implementation contract for Sahaay Voice. A coding agent should use it as the source of truth when creating the first working prototype. If a later decision conflicts with this document, preserve the safety and booking invariants first and record the change in the project notes.

## 2. Product summary

Sahaay is an accessibility-first voice assistant that helps people access public-health services without navigating a complex app or website. The first release completes one administrative workflow: searching for and booking a fictional public-clinic appointment.

Sahaay is not a doctor, triage service, diagnosis system, prescription assistant, or emergency-response service. It must not make clinical recommendations.

## 3. Users and primary scenario

### Primary user

An elderly, low-literacy, visually impaired, rural, or non-native-language user who wants to book an appointment and may not be comfortable with a smartphone form.

### Primary scenario

The user says a natural request such as “I need a diabetes checkup next week.” Sahaay asks only the missing questions, searches fictional public-clinic availability, reads the selected details back, waits for an explicit confirmation, and then creates one booking.

### Secondary users

- A family member or carer who needs a visible transcript
- A human operator who receives escalated conversations
- A judge who needs to understand the value and reliability during a live demo

## 4. Goals

The MVP must:

1. Let a user complete the appointment workflow by voice.
2. Support a second language or a clearly implemented accessibility mode.
3. Work with a browser microphone and a text/mock fallback.
4. Make uncertainty visible and ask clarifying questions.
5. Never book without explicit confirmation.
6. Provide a useful human handoff containing transcript and collected fields.
7. Use fictional data only during development and demonstrations.
8. Expose enough state and audit information to test the agent.

## 5. Non-goals for the hackathon MVP

Do not build these in the first version:

- Medical diagnosis or symptom triage
- Prescription, dosage, or treatment advice
- Emergency dispatch
- Real patient records or production healthcare integrations
- Real payment processing
- Open-ended general-purpose personal assistant behavior
- Many unrelated appointment types
- A fully autonomous outbound calling campaign

## 6. Functional requirements

### FR-01: Session start and consent

- The interface must clearly say that the user is speaking with an AI assistant.
- The assistant must greet the user briefly and ask for language preference if it is not already known.
- Before recording or storing audio/transcripts beyond the active session, the system must show or speak a consent notice.
- A user must be able to end the session at any time.

### FR-02: Language and accessibility

- The user can select the supported language before beginning.
- The agent must continue in the selected language unless the user requests a switch.
- The interface must support keyboard navigation, visible focus, large text, high contrast, and a clearly labeled microphone control.
- The user must be able to ask the agent to repeat, speak slower, go back, or connect to a human.
- The transcript must be visible to a carer/operator and available as text even when the user does not look at the screen.
- If a language is unsupported, the agent must say so plainly and offer the supported language or human handoff.

### FR-03: Intent and scope

- The agent must recognize appointment booking, appointment search, cancellation/request-to-change, repeat, language switch, help, and human handoff intents.
- The MVP may implement only booking end to end; other intents must receive a safe explanation or handoff.
- Requests for diagnosis, medical advice, emergency help, or prescriptions must be refused safely and redirected to an official human/medical channel.

### FR-04: Required appointment fields

The booking state must track these fields explicitly:

| Field | Required | Validation |
|---|---:|---|
| patient_name | Yes | Non-empty; ask for spelling when unclear |
| service | Yes | One of the seeded services |
| location | Yes | One of the seeded clinics/areas |
| preferred_date_range | Yes | Valid future date or range |
| contact_number | Yes | Normalized phone format |
| selected_slot_id | Yes before confirmation | Must exist and be available |
| consent_to_book | Yes | Must be explicit positive confirmation |

The agent must not ask for unnecessary medical history, identity documents, payment details, or sensitive information.

### FR-05: Conversation behavior

- Ask one question at a time.
- Prefer short sentences and familiar vocabulary.
- Confirm important values such as names, dates, times, phone numbers, and clinic names.
- If speech recognition is uncertain, repeat the interpreted value and ask for correction.
- Never silently transform an ambiguous date such as “next Friday”; ask for the calendar date.
- If the user interrupts, stop or yield naturally and process the new turn.
- If the user is silent, ask once if they are still there, then offer retry or handoff.

### FR-06: Appointment search

- The server must own the appointment data and search logic.
- The model may call `search_slots`, but it must not invent availability.
- Results must contain a stable `slot_id`, clinic, department/service, date, time, and accessibility notes if present.
- The agent must present no more than three options at once.
- If there are no matches, the agent must offer a wider date/location search or handoff.

### FR-07: Confirmation and booking

- Before booking, the agent must read back all booking details in one clear summary.
- The confirmation must ask for an explicit yes/no response.
- “Maybe”, silence, or an unrelated phrase is not confirmation.
- The server must independently verify that all required fields are valid and that the slot is still available.
- `book_appointment` must be idempotent. Repeated calls with the same confirmation/session must not create duplicates.
- A successful booking response must include a fictional confirmation reference.
- The assistant must never claim a booking succeeded if the tool failed or timed out.

### FR-08: Human handoff

Handoff must be available when:

- The user asks for a human.
- The agent cannot confidently interpret a required field after two attempts.
- The request is outside the supported workflow.
- A tool or network error prevents safe completion.
- The user appears distressed or asks for urgent help.

The handoff payload must include session ID, reason, transcript, language, collected fields, last known state, and unresolved question. The UI must show that a handoff was created.

### FR-09: Notifications

- The MVP may simulate SMS/WhatsApp delivery.
- The confirmation must contain clinic, service, date, time, and reference number.
- The UI must label simulated delivery clearly.
- Notifications must not expose data from another session.

### FR-10: Operator dashboard

The operator view must show:

- Session status: active, completed, handed off, or failed
- Transcript with speaker labels
- Current state and next expected action
- Extracted fields and confidence/validation status
- Tool calls and results
- Confirmation event
- Handoff reason and payload
- Basic metrics for the current demo session

## 7. Technical requirements

### TR-01: Separation of responsibilities

Keep these layers separate:

1. Voice transport and audio session
2. Agent/controller and state machine
3. Tool schemas and business validation
4. Mock appointment repository
5. UI and operator dashboard
6. Logging/evaluation

The language model must not be the source of truth for appointment availability or booking validity.

### TR-02: Voice integration

- Prefer the OpenAI Realtime API for the final natural conversation.
- Keep a text/chained fallback for development and network failure.
- Store the selected model name in environment configuration.
- Do not expose the OpenAI API key to browser code; use a server-issued ephemeral session or server-side proxy appropriate to the chosen integration.
- Close inactive voice sessions to control credit usage.

### TR-03: Tool contract

Tools must use strict structured inputs and outputs. Minimum tools:

```text
search_slots({ service, location, date_from, date_to })
validate_details({ patient_name, contact_number, service, location, selected_slot_id })
book_appointment({ session_id, idempotency_key, validated_details })
send_confirmation({ booking_reference, contact_number, channel })
create_handoff({ session_id, reason, transcript, collected_fields })
```

Every tool must return a machine-readable success/error result and a safe user-facing summary.

### TR-04: State persistence

At minimum, persist the active session state in memory or a local database. The state must include session ID, language, current state, fields, transcript, tool events, confirmation status, and timestamps.

### TR-05: Error handling

Errors must be categorized as validation, no-result, unavailable-slot, duplicate, timeout, network, or internal error. The model must not receive raw stack traces or secrets.

### TR-06: Security

- Store secrets only in `.env` or the deployment secret manager.
- Add `.env` to `.gitignore`.
- Use fictional test data.
- Redact phone numbers and names in logs where possible.
- Validate all tool inputs on the server.
- Rate-limit session creation if a public endpoint is exposed.
- Do not log raw audio by default.

## 8. Quality requirements

The demo build should meet these targets against scripted conversations:

- At least 85% end-to-end task completion
- Zero incorrect bookings
- 100% explicit confirmation before booking
- No invented appointment slots
- Safe handling for every out-of-scope medical request
- Human handoff available in every failure path
- Keyboard-only completion for the web UI
- A working text/mock fallback when microphone or network access fails

## 9. Required test fixtures

Seed fictional data for:

- At least three clinics
- At least two services
- At least five available slots
- One unavailable/expired slot
- One duplicate-booking scenario
- One unsupported-language scenario
- One human-handoff scenario

Use deterministic test data so every demo run is reproducible.

## 10. Definition of done

The implementation is ready for judging when a fresh user can start the app, select a language, complete a voice appointment booking, see the booking result in the operator view, and reproduce a safe clarification/handoff scenario without a developer manually editing state.

