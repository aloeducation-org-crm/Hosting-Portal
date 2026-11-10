# LiteLLM proxy config — rendered via envsubst.
# Secrets are read at runtime from /etc/litellm/litellm.env (0600) via os.environ/*.
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
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-1.5-pro
    litellm_params:
      model: gemini/gemini-1.5-pro
      api_key: os.environ/GEMINI_API_KEY
  - model_name: groq-llama-3.1-8b-instant
    litellm_params:
      model: groq/llama-3.1-8b-instant
      api_key: os.environ/GROQ_API_KEY
  - model_name: groq-llama-3.3-70b-versatile
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY
  - model_name: glm-5
    litellm_params:
      model: openai/glm-5
      api_base: ${KIT_GLM_BASE_URL}
      api_key: os.environ/GLM_API_KEY
  - model_name: glm-5.3-flash
    litellm_params:
      model: openai/glm-5.3-flash
      api_base: ${KIT_GLM_BASE_URL}
      api_key: os.environ/GLM_API_KEY

router_settings:
  routing_strategy: simple-shuffle
  fallbacks:
    - gemini-1.5-flash:
        - groq-llama-3.1-8b-instant
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
  request_timeout: 90
  telemetry: false

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  disable_view_yaml: true
  # Note: LiteLLM DB-backed virtual keys require PostgreSQL (not SQLite).
  # Set DATABASE_URL in /etc/litellm/litellm.env and store_model_in_db: true only after creating a dedicated Postgres DB.
  store_model_in_db: false
