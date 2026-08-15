# Sahaay Voice

Implementation handoff: [REQUIREMENTS.md](REQUIREMENTS.md) · [WORKFLOW.md](WORKFLOW.md)

> A voice-first public-health access assistant for people who struggle with apps, reading, vision, language, or reliable internet access.

Sahaay helps an elderly, low-literacy, visually impaired, rural, or non-native-language user complete one essential task end to end: finding and booking a public-health appointment. It uses simple spoken conversation, reads every important detail back for confirmation, and hands off to a human when uncertain.

This is an administrative access assistant, not a medical diagnosis or treatment system.

## The first demo workflow

```text
Choose language -> Say what help is needed -> Collect required details
-> Find a slot -> Read details back -> Confirm -> Book -> Send confirmation
```

Example: “I need a diabetes checkup next week.” The assistant asks for the person's name, preferred day, and location; shows a matching appointment; repeats the complete booking; and submits only after an explicit yes.

## Target users

- Elderly people who find mobile apps difficult
- People with low literacy or limited digital confidence
- Visually impaired users who need a spoken interface
- Rural users with limited bandwidth or device access
- Immigrants and non-native-language speakers
- Patients trying to reach public healthcare services

## What to build

Build a voice assistant that supports language selection, appointment requests, structured field collection, slot search, explicit confirmation, SMS-style confirmation, and human handoff. Include a large high-contrast interface, live transcript, repeat/slower controls, keyboard navigation, and keypad fallback.

The operator view should show the transcript, workflow state, extracted fields and confidence, appointment options, confirmation/handoff events, and evaluation metrics.

## Architecture

```text
Browser microphone / phone gateway
              |
              v
      OpenAI voice session
              |
              v
     Conversation controller
              |
              +--> search_slots / validate_details / book_appointment
              +--> send_confirmation / human_handoff
              |
              v
       Transcript + audit events -> Operator UI
```

Use the OpenAI Realtime API for the live browser conversation when natural interruption and low latency matter. Keep booking logic in normal application code. The model may interpret speech and call tools, but the server must validate fields and enforce confirmation before `book_appointment` runs.

For a simpler prototype, use `audio -> speech-to-text -> text model + tools -> text-to-speech`; the same tool contract can later move to Realtime.

## Build workflow

### 1. Define the contract

Pick one region, one language pair, and one service such as booking a public clinic appointment. Define required fields and out-of-scope requests: diagnosis, emergencies, prescriptions, and medical advice.

### 2. Build deterministic mock services

Create fictional clinics, departments, dates, and slots. Implement `search_slots`, `validate_details`, `book_appointment`, and `send_confirmation`. Make booking idempotent so repeated turns cannot create duplicate appointments.

### 3. Build the agent loop

Use a state machine: `greeting -> collect -> search -> select -> confirm -> booked | handoff`. Add strict tool schemas, language rules, safety boundaries, and logs for tool calls and state changes.

### 4. Build the accessible interface

Use keyboard navigation, visible focus, large text, high contrast, clear microphone states, transcript, replay, slower speech, and handoff controls. Every visual status must also have a spoken or text equivalent.

### 5. Test scripted conversations

Include accents, background noise, interruptions, code-switching, missing details, ambiguous dates, unavailable slots, refusals, tool failures, and repeated confirmations.

### 6. Prepare the live demo

Seed three slots and one unavailable slot. Demonstrate one successful booking and one safe handoff. Keep the transcript and state panel visible. Have text input, pre-recorded audio, and mock data as fallbacks.

## Agent test plan

| Scenario | Expected result |
|---|---|
| Appointment request | Collect required fields |
| Supported second language | Continue in that language |
| Invalid or ambiguous date | Ask for clarification; do not search or book |
| No matching slot | Offer alternatives or handoff |
| User says “book it” | Read full details and request confirmation |
| User says “no” | Do not book; return to slot selection |
| User asks for diagnosis | Explain scope and offer official/human help |
| User asks for a person | Handoff with transcript and fields |
| Tool/network failure | Explain failure; never claim success |
| Duplicate confirmation | Create only one appointment |
| User asks to repeat | Repeat the last step slowly |

Track task completion rate, incorrect bookings, confirmation compliance, average turns, clarification rate, handoff rate, tool recovery rate, and language-specific success rate. Target 85%+ completion, zero incorrect bookings, and 100% confirmation compliance.

## Live testing

### Browser

1. Start the API and web app.
2. Open Chrome or Edge and allow microphone access.
3. Select the demo language and run the successful booking script.
4. Run the ambiguous-date or unavailable-slot script.
5. Verify the dashboard, appointment record, and confirmation message.

### Phone

When a phone gateway is connected, test interruptions, silence timeouts, human transfer, consent wording, and SMS confirmation. Use fictional names, phone numbers, and appointments only.

### Fallbacks

Keep a text-input path, browser microphone path, two pre-recorded audio samples, and a local/mock appointment service. Label simulated actions clearly.

## OpenAI services and credits

Create an OpenAI API key and keep it only in a local `.env` file. Never commit it.

```env
OPENAI_API_KEY=replace_me
OPENAI_VOICE_MODEL=replace_with_current_realtime_model
OPENAI_TEXT_MODEL=replace_with_current_fast_text_model
```

Use the voice model for live speech, turn-taking, interruptions, and spoken replies. Use a lower-cost text model for test generation, summaries, operator notes, and offline evaluation.

To reduce credit usage: keep prompts short and stable; send only current workflow state; keep appointment data local; validate with deterministic code; limit the demo to one workflow; end inactive sessions quickly; and avoid sending the full transcript repeatedly.

Monitor usage in the OpenAI usage dashboard and stop each voice connection when a test ends.

## Safety and privacy

- Tell users they are speaking with an AI assistant.
- Ask consent before storing audio or transcripts.
- Do not provide diagnosis, emergency instructions, or medication decisions.
- Tell users to contact local emergency services for emergencies.
- Collect only appointment information needed for the demo.
- Redact names and phone numbers in logs where possible.
- Require explicit confirmation before booking or sharing details.
- Use mock data for all public demonstrations.

## Suggested structure

```text
.
├── README.md
├── apps/web/                 # accessible user and operator interfaces
├── apps/api/                 # server, agent controller, and tools
├── packages/agent/           # prompts, state machine, tool schemas
├── packages/shared/          # types and validation
├── data/appointments.json    # fictional demo data
├── tests/conversations/      # scripted transcripts
├── tests/accessibility/      # keyboard and screen-reader checks
├── .env.example
└── package.json
```

## Definition of done

- A user completes one appointment booking by voice.
- Two languages or one language plus a clear accessibility mode work.
- The assistant never books without explicit confirmation.
- Ambiguous dates and unavailable slots are handled safely.
- Human handoff includes transcript and collected details.
- A microphone path and text/mock fallback both work.
- No real personal or medical data is used.

Start with the mock appointment service and state machine before tuning voice. Once safe booking passes the scripted tests, connect the OpenAI voice model.
