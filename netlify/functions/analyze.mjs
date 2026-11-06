const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const form = await request.formData();
    const type = String(form.get("type") || "");

    if (type === "text") {
      const apiKey = process.env.GPTZERO_API_KEY;
      if (!apiKey) return json({ error: "A chave GPTZERO_API_KEY ainda não foi configurada no Netlify." }, 503);

      const text = String(form.get("text") || "").trim();
      if (text.length < 100) return json({ error: "O texto precisa ter pelo menos 100 caracteres." }, 400);
      if (text.length > 12000) return json({ error: "Limite de 12.000 caracteres nesta versão." }, 400);

      const upstream = await fetch("https://api.gptzero.me/v2/predict/text", {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ document: text })
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json({ error: result.message || result.error || `GPTZero respondeu HTTP ${upstream.status}. Verifique a chave e o plano da API.` }, upstream.status);
      }
      const doc = result.documents?.[0];
      if (!doc) return json({ error: "O serviço não retornou um resultado de documento." }, 502);
      return json({
        predicted_class: doc.predicted_class,
        class_probabilities: doc.class_probabilities || {},
        confidence_category: doc.confidence_category,
        result_message: doc.result_message,
        model_version: result.version
      });
    }

    if (type === "image" || type === "video") {
      const apiUser = process.env.SIGHTENGINE_API_USER;
      const apiSecret = process.env.SIGHTENGINE_API_SECRET;
      if (!apiUser || !apiSecret) {
        return json({ error: "Configure SIGHTENGINE_API_USER e SIGHTENGINE_API_SECRET nas variáveis do Netlify." }, 503);
      }

      const file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Arquivo não recebido." }, 400);
      if (file.size > 4 * 1024 * 1024) return json({ error: "Arquivo maior que 4 MB. Reduza o tamanho e tente novamente." }, 413);

      const allowedImage = ["image/jpeg", "image/png", "image/webp"];
      const allowedVideo = ["video/mp4", "video/webm", "video/quicktime"];
      if (type === "image" && !allowedImage.includes(file.type)) return json({ error: "Formato de imagem não aceito. Use JPG, PNG ou WEBP." }, 415);
      if (type === "video" && !allowedVideo.includes(file.type)) return json({ error: "Formato de vídeo não aceito. Use MP4, WEBM ou MOV." }, 415);

      const target = type === "image"
        ? "https://api.sightengine.com/1.0/check.json"
        : "https://api.sightengine.com/1.0/video/check-sync.json";

      const outgoing = new FormData();
      outgoing.append("media", new Blob([await file.arrayBuffer()], { type: file.type }), file.name || "upload");
      outgoing.append("models", "genai");
      outgoing.append("api_user", apiUser);
      outgoing.append("api_secret", apiSecret);

      const upstream = await fetch(target, { method: "POST", body: outgoing });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok || result.status === "failure") {
        return json({ error: result.error?.message || result.message || `Sightengine respondeu HTTP ${upstream.status}.` }, upstream.status || 502);
      }

      if (type === "image") {
        const probability = Number(result.type?.ai_generated);
        if (!Number.isFinite(probability)) return json({ error: "A API não retornou a pontuação ai_generated." }, 502);
        return json({ ai_probability: probability * 100, filename: file.name });
      }

      const frames = result.data?.frames || result.frames || [];
      const scores = frames
        .map(frame => Number(frame.type?.ai_generated))
        .filter(value => Number.isFinite(value));
      if (!scores.length) return json({ error: "O serviço não retornou pontuações dos quadros do vídeo. Confira se o vídeo é compatível e tem menos de 60 segundos." }, 502);
      const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      return json({ ai_probability: average * 100, frames_analyzed: scores.length, filename: file.name });
    }

    return json({ error: "Tipo de análise inválido." }, 400);
  } catch (error) {
    return json({ error: error.message || "Erro interno ao analisar o arquivo." }, 500);
  }
};
