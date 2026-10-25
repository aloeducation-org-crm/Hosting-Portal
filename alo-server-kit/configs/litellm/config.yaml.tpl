# LiteLLM proxy config — rendered via envsubst.
model_list:
  - model_name: qwen2.5:7b
    litellm_params:
      model: ollama/qwen2.5:7b
      api_base: http://127.0.0.1:${KIT_OLLAMA_PORT}
  - model_name: llama3.1:8b
    litellm_params:
      model: ollama/llama3.1:8b
      api_base: http://127.0.0.1:${KIT_OLLAMA_PORT}
  - model_name: codellama:7b
    litellm_params:
      model: ollama/codellama:7b
      api_base: http://127.0.0.1:${KIT_OLLAMA_PORT}
  - model_name: gemini-1.5-flash
    litellm_params:
      model: gemini/gemini-1.5-flash
      api_key: ${KIT_GEMINI_API_KEY}
  - model_name: gemini-1.5-pro
    litellm_params:
      model: gemini/gemini-1.5-pro
      api_key: ${KIT_GEMINI_API_KEY}
  - model_name: groq-llama-3.1-8b-instant
    litellm_params:
      model: groq/llama-3.1-8b-instant
      api_key: ${KIT_GROQ_API_KEY}
  - model_name: groq-llama-3.3-70b-versatile
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: ${KIT_GROQ_API_KEY}
  - model_name: cf-llama-3.1-8b-instruct
    litellm_params:
      model: cloudflare/llama-3.1-8b-instruct
      api_base: https://api.cloudflare.com/client/v4/accounts/${KIT_CLOUDFLARE_AI_ACCOUNT_ID}/ai/v1
      api_key: ${KIT_CLOUDFLARE_AI_API_TOKEN}

router_settings:
  routing_strategy: simple-shuffle
  fallbacks:
    - gemini-1.5-flash:
        - groq-llama-3.1-8b-instant
        - cf-llama-3.1-8b-instruct
        - qwen2.5:7b
    - gemini-1.5-pro:
        - groq-llama-3.3-70b-versatile
        - llama3.1:8b
    - groq-llama-3.1-8b-instant:
        - gemini-1.5-flash
        - qwen2.5:7b
    - groq-llama-3.3-70b-versatile:
        - gemini-1.5-pro
        - llama3.1:8b
    - codellama:7b:
        - groq-llama-3.1-8b-instant
        - gemini-1.5-flash
  num_retries: 2
  timeout: 60
  retry_after: 5

litellm_settings:
  drop_params: true
  max_budget: 0
  budget_duration: 30d
  telemetry: false

general_settings:
  master_key: ${KIT_LITELLM_MASTER_KEY}
  database_url: sqlite:///opt/litellm/litellm.db
  disable_view_yaml: true
  store_model_in_db: true
  enable_budget_rate_limits: true
