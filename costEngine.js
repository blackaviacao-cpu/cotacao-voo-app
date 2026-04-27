// ==========================
// COST ENGINE — BLACK
// Regra atual:
// custo operacional da rota = soma dos custos / soma dos km
// combustível fica fora por enquanto
// ==========================

const MARGEM_ALVO = 0.55;
const SIMILARIDADE_DIST = 0.2;
const MIN_VOOS_SIMILARES = 3;

// ==========================
// UTIL
// ==========================
function num(v) {
  if (v === null || v === undefined || v === "") return 0;

  if (typeof v === "number") {
    return isNaN(v) ? 0 : v;
  }

  let s = String(v)
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim();

  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function valorCampo(row, nomes) {
  for (const nome of nomes) {
    if (row[nome] !== undefined) return num(row[nome]);
  }
  return 0;
}

// ==========================
// CUSTO OPERACIONAL — SEM COMBUSTÍVEL
// ==========================
function custoOperacionalVoo(row) {
  return (
    num(row["decea"]) +
    num(row["tx.aerop."]) +
    num(row["comissaria"]) +
    num(row["fbo"]) +
    num(row["hospedagem"]) +
    num(row["transporte"]) +
    num(row["slot"]) +
    num(row["outros"]) +
    num(row["comissoes"]) +
    valorCampo(row, ["variavel trip.", "variável trip."]) +
    num(row["com.terceiros"]) +
    num(row["mntc.hr"])
  );
}

// ==========================
// PREPARAR BASE
// ==========================
function prepararBase(base) {
  return base.map(row => {
    const km = num(row["dist_km"]);
    const custo = custoOperacionalVoo(row);

    return {
      origem: row.origem,
      destino: row.destino,
      km,
      custo
    };
  }).filter(v =>
    v.origem &&
    v.destino &&
    v.km > 0
  );
}

// ==========================
// AGRUPAR ROTAS
// ==========================
function agruparRotas(basePreparada) {
  const rotas = {};

  basePreparada.forEach(v => {
    const key = `${v.origem}_${v.destino}`;
    if (!rotas[key]) rotas[key] = [];
    rotas[key].push(v);
  });

  return rotas;
}

// ==========================
// CUSTO R$/KM = SOMA CUSTOS / SOMA KM
// ==========================
function custoKmPorAmostra(voos) {
  const totalCusto = voos.reduce((s, v) => s + v.custo, 0);
  const totalKm = voos.reduce((s, v) => s + v.km, 0);

  return totalKm > 0 ? totalCusto / totalKm : 0;
}

// ==========================
// BUSCAR CUSTO R$/KM DA ROTA
// ==========================
function obterCustoKm(basePreparada, rotas, origem, destino, kmRef) {
  const key = `${origem}_${destino}`;

  // 1) rota exata
  if (rotas[key] && rotas[key].length) {
    return custoKmPorAmostra(rotas[key]);
  }

  // 2) fallback por distância similar
  const min = kmRef * (1 - SIMILARIDADE_DIST);
  const max = kmRef * (1 + SIMILARIDADE_DIST);

  const similares = basePreparada.filter(v =>
    v.km >= min && v.km <= max
  );

  if (similares.length >= MIN_VOOS_SIMILARES) {
    return custoKmPorAmostra(similares);
  }

  // 3) fallback global
  return custoKmPorAmostra(basePreparada);
}

// ==========================
// AUDITORIA
// ==========================
function auditarCustoTrecho(baseRaw, origem, destino, kmRef) {
  const basePreparada = prepararBase(baseRaw);
  const linhas = basePreparada.filter(v =>
    v.origem === origem && v.destino === destino
  );

  const totalCusto = linhas.reduce((s, v) => s + v.custo, 0);
  const totalKm = linhas.reduce((s, v) => s + v.km, 0);
  const custoKm = totalKm > 0 ? totalCusto / totalKm : 0;
  const custoTrecho = custoKm * kmRef;

  console.group(`AUDITORIA ${origem} → ${destino}`);
  console.table(linhas);
  console.log("TOTAL CUSTO:", totalCusto);
  console.log("TOTAL KM:", totalKm);
  console.log("CUSTO R$/KM:", custoKm);
  console.log("KM COTADO:", kmRef);
  console.log("CUSTO ESTIMADO DO TRECHO:", custoTrecho);
  console.groupEnd();

  return {
    totalCusto,
    totalKm,
    custoKm,
    custoTrecho
  };
}

// ==========================
// PRECIFICAÇÃO
// ==========================
function precoSugerido(custo) {
  return custo / (1 - MARGEM_ALVO);
}

function margem(preco, custo) {
  if (preco <= 0) return 0;
  return (preco - custo) / preco;
}

// ==========================
// ENGINE PRINCIPAL
// ==========================
function analisarMissao({ trechos, precoKmUsuario }, baseRaw) {
  const basePreparada = prepararBase(baseRaw);
  const rotas = agruparRotas(basePreparada);

  let totalKm = 0;
  let totalCusto = 0;

  const resultadoTrechos = trechos.map(t => {
    const custoKm = obterCustoKm(
      basePreparada,
      rotas,
      t.origem,
      t.destino,
      t.km
    );

    const custo = custoKm * t.km;

    totalKm += t.km;
    totalCusto += custo;

    return {
      ...t,
      custoKm,
      custo
    };
  });

  const precoUsuario = precoKmUsuario * totalKm;
  const precoIdeal = precoSugerido(totalCusto);
  const margemReal = margem(precoUsuario, totalCusto);

  return {
    trechos: resultadoTrechos,
    totalKm,
    totalCusto,
    custoKmMedio: totalKm > 0 ? totalCusto / totalKm : 0,
    precoUsuario,
    precoIdeal,
    margemReal
  };
}
