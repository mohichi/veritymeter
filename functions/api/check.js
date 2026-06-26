// Cloudflare Pages Functions
// /api/check
// コスト最適化版（フロント互換）

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const body = await request.json();
    const url = (body.url || "").trim();

    if (!url || !url.startsWith("http")) {
      return new Response(
        JSON.stringify({
          error: "正しいURLを指定してください",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const apiKey = env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "サーバー側のAPIキーが設定されていません",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // --------------------------
    // キャッシュ確認
    // --------------------------

    const cacheKey =
      "check:" + encodeURIComponent(url);

    if (env.NEWS_KV) {
      const cached =
        await env.NEWS_KV.get(cacheKey);

      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        });
      }
    }

    // --------------------------
    // 短縮Prompt
    // --------------------------

    const systemPrompt = `
あなたは記事信頼性評価AIです。

記事内容の信憑性を評価してください。

評価観点:
- 根拠の有無
- 一次情報の存在
- 誇張や煽り表現
- 推測と事実の区別

JSONのみ返答してください。

{
  "article_title":"",
  "article_site":"",
  "article_excerpt":"",
  "score":0,
  "verdict":"",
  "summary":"",
  "positives":[{"text":""}],
  "warnings":[{"text":"","excerpt":""}],
  "verdict_full":"",
  "tags":[],
  "media_background":{
    "source_type":"",
    "media_note":""
  }
}
`;

    const apiRes = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku",

          max_tokens: 800,

          system: systemPrompt,

          messages: [
            {
              role: "user",
              content:
                `URLの記事を信憑性評価してください。\n${url}`,
            },
          ],

          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
        }),
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();

      return new Response(
        JSON.stringify({
          error:
            "AI分析サービスでエラーが発生しました",
          detail: errText.slice(0, 500),
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const data = await apiRes.json();

    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let json;

    try {
      const braceIdx =
        fullText.indexOf("{");

      if (braceIdx < 0) {
        throw new Error("JSON not found");
      }

      let depth = 0;
      let endIdx = -1;

      for (
        let i = braceIdx;
        i < fullText.length;
        i++
      ) {
        if (fullText[i] === "{") depth++;

        if (fullText[i] === "}") {
          depth--;

          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx < 0) {
        throw new Error("JSON incomplete");
      }

      json = JSON.parse(
        fullText.slice(
          braceIdx,
          endIdx + 1
        )
      );
    } catch (e) {
      return new Response(
        JSON.stringify({
          error:
            "分析結果の解析に失敗しました",
          raw_response:
            fullText.slice(0, 2000),
          stop_reason:
            data.stop_reason || null,
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const resultJson =
      JSON.stringify(json);

    // --------------------------
    // キャッシュ保存（30日）
    // --------------------------

    if (env.NEWS_KV) {
      await env.NEWS_KV.put(
        cacheKey,
        resultJson,
        {
          expirationTtl:
            60 * 60 * 24 * 30,
        }
      );
    }

    return new Response(
      resultJson,
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error:
          "サーバーエラーが発生しました",
        detail: String(e),
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type",
    },
  });
}
