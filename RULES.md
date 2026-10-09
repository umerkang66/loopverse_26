# Hackathon Rules & Guidelines

## 1. Time Limit
The hackathon strictly lasts for 24 hours. The development window begins immediately after the kickoff announcement. Any commits or modifications made after the deadline will result in point deductions or disqualification.

## 2. Team Size
Teams must consist of 1 to 4 registered participants. While solo participation is allowed, building a multi-agent orchestration system and UI within 24 hours can be complex, so teaming up is highly encouraged.

## 3. Allowed Technologies
- **Languages & Frameworks:** You are free to use any programming language (Python, TypeScript, Go, etc.) and any UI framework (Streamlit, React, Gradio, Chainlit).
- **AI Models:** You may use any accessible LLM (OpenAI, Anthropic, Google Gemini, local models like Llama 3, etc.).
- **Agent Frameworks:** Tools like LangChain, LangGraph, CrewAI, or AutoGen are fully permitted and highly encouraged.

## 4. The UI Mandate
A visual dashboard/UI is **STRICTLY MANDATORY**. 
Judges will not evaluate raw terminal output or Jupyter Notebook logs. The UI must clearly display:
- Live Agent Transcripts
- Current Resource Pool state
- Validation results (Pass/Fail)
- Event Injection controls

## 5. Fair Play & Hardcoding
- **No Hardcoding:** Agent responses, negotiation turns, or fallback plans cannot be hardcoded. The agents must genuinely negotiate based on LLM outputs and deterministic validator feedback.
- **No Fabricated Logs:** Providing pre-generated JSON logs and presenting them as a "live run" will lead to immediate disqualification.

## 6. Submission Policy
You must submit a link to a public/private GitHub repository and a 3-5 minute video demonstrating your working UI, a successful negotiation, and the handling of a crisis event. Ensure no secret API keys are committed to your repository.
