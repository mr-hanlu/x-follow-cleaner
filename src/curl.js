(function (app) {
  app.tokenizeCurl = function (curlText) {
    const source = String(curlText || "").replace(/\\\r?\n/g, " ");
    const tokens = [];
    let token = "";
    let quote = "";
    const push = () => {
      if (token) tokens.push(token);
      token = "";
    };
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote === "'") {
        if (character === "'") quote = "";
        else token += character;
      } else if (quote === '"') {
        if (character === '"') quote = "";
        else if (character === "\\" && index + 1 < source.length) token += source[++index];
        else token += character;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "\\" && index + 1 < source.length) {
        token += source[++index];
      } else if (/\s/.test(character)) {
        push();
      } else {
        token += character;
      }
    }
    if (quote) throw new Error("cURL 中存在未闭合的引号。");
    push();
    return tokens;
  };

  app.parseCurl = function (curlText) {
    const tokens = app.tokenizeCurl(curlText);
    let url = "";
    const headers = {};
    const dataParts = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === "--url" || token === "-X" || token === "--request") && index + 1 < tokens.length) {
        const value = tokens[++index];
        if (token === "--url") url = value;
        continue;
      }
      if (token.startsWith("--url=")) url = token.slice(6);
      if (!url && /^https?:\/\//.test(token)) url = token;
      let header = "";
      if ((token === "-H" || token === "--header") && index + 1 < tokens.length) header = tokens[++index];
      else if (token.startsWith("--header=")) header = token.slice(9);
      if (header) {
        const colon = header.indexOf(":");
        if (colon > 0) headers[header.slice(0, colon).trim().toLowerCase()] = header.slice(colon + 1).trim();
      }
      if ((token === "--data" || token === "--data-raw" || token === "--data-urlencode" || token === "-d") && index + 1 < tokens.length) {
        dataParts.push(tokens[++index]);
      } else if (token.startsWith("--data=")) {
        dataParts.push(token.slice(7));
      } else if (token.startsWith("--data-raw=")) {
        dataParts.push(token.slice(11));
      }
    }
    if (!url) throw new Error("没有从 cURL 找到请求 URL。");
    return { url: new URL(url), headers, body: dataParts.join("&") };
  };
})(window.XFollowCleaner);
