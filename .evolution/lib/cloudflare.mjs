export class QuotaPauseError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuotaPauseError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quotaLike(status, details) {
  return (
    status === 402 ||
    status === 429 ||
    /quota|rate limit|limit exceeded|neurons|capacity/i.test(String(details || ""))
  );
}

function retryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createCloudflareClient({
  model,
  criticModel,
  explorerModel,
  timeoutMs = 45_000,
  maxRetries = 3,
  onRetry = null,
} = {}) {
  function config() {
    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
    const token = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || "").trim();
    if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID.");
    if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
    return { accountId, token };
  }

  async function call(messages, {
    tools = null,
    temperature = 0.2,
    maxTokens = 1800,
    selectedModel = model,
  } = {}) {
    const { accountId, token } = config();
    let attempt = 0;

    while (true) {
      attempt += 1;
      let response;

      try {
        const body = {
          model: selectedModel,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        };

        if (Array.isArray(tools) && tools.length) {
          body.tools = tools;
          body.tool_choice = "auto";
        }

        response = await fetch(
          "https://api.cloudflare.com/client/v4/accounts/" +
            encodeURIComponent(accountId) +
            "/ai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
      } catch (error) {
        const timeout =
          error?.name === "TimeoutError" ||
          error?.name === "AbortError" ||
          /timed out|timeout/i.test(error?.message || "");

        if (attempt <= maxRetries) {
          if (onRetry) await onRetry({ attempt, reason: timeout ? "timeout" : "network", error });
          await sleep(Math.min(8000, 750 * 2 ** (attempt - 1)));
          continue;
        }

        throw new Error(
          timeout
            ? "Workers AI request timed out after " + timeoutMs + "ms."
            : "Could not reach Workers AI after retries: " + (error?.message || error)
        );
      }

      if (!response.ok) {
        const details = await response.text().catch(() => "");

        if (quotaLike(response.status, details)) {
          throw new QuotaPauseError("Workers AI quota/rate limit reached (" + response.status + ").");
        }

        if (retryable(response.status) && attempt <= maxRetries) {
          const retryAfter = Number(response.headers.get("retry-after") || 0);
          if (onRetry) await onRetry({ attempt, reason: "http-" + response.status, details });
          await sleep(
            retryAfter > 0
              ? Math.min(15_000, retryAfter * 1000)
              : Math.min(8000, 750 * 2 ** (attempt - 1))
          );
          continue;
        }

        throw new Error(
          "Cloudflare Workers AI error " +
            response.status +
            ": " +
            details.slice(0, 1400)
        );
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      if (!message) throw new Error("Workers AI returned no assistant message.");
      return {
        message,
        usage: data?.usage || null,
        model: data?.model || selectedModel,
        attempts: attempt,
      };
    }
  }

  return {
    call,
    models: {
      engineer: model,
      critic: criticModel || model,
      explorer: explorerModel || model,
    },
  };
}
