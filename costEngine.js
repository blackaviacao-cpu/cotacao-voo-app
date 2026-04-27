// ==========================
// COST ENGINE — BLACK
// ==========================

const FATOR_LBS_LITROS = 0.567;
const MARGEM_ALVO = 0.55;
const SIMILARIDADE_DIST = 0.2; // ±20%
const MIN_VOOS_SIMILARES = 3;

// ==========================
// UTIL
// ==========================
function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  return parseFloat(String(v).replace(/\./g, "").replace(",", "."));
}

// ==========================
// CAMADA 1 — COMBUSTÍVEL
// ==========================
function lbsToLitros(lbs) {
  return num(lbs) * FATOR_LBS_LITROS;
}

function calcularPrecoLitro(row, precoMedioGlobal) {
  const litros = num(row["abast.lt."]);
  const valor = num(row["abast."]);

  if (litros > 0 && valor > 0) {
    return valor / litros;
  }

  return precoMedioGlobal;
}

function calcularPrecoMedioGlobal(base) {
  const ultimos = base.slice(-90);

  let totalValor = 0;
  let totalLitros = 0;

  ultimos.forEach(r => {
    const litros = num(r["abast.lt."]);
    const valor = num(r["abast."]);

    if (litros > 0 && valor > 0) {
      totalValor += valor;
      totalLitros += litros;
    }
  });

  if (totalLitros === 0) return 0;
  return totalValor / totalLitros;
}

function custoCombustivel(row, precoLitro) {
  const litrosConsumidos = lbsToLitros(row["consm.lbs"]);
  return litrosConsumidos * precoLitro;
}

// ==========================
// CAMADA 2 — CUSTO ALL-IN
// ==========================
function custoTotalVoo(row, precoLitro) {

  const combustivel = custoCombustivel(row, precoLitro);

  return (
    combustivel +
    num(row["decea"]) +
    num(row["tx.aerop."]) +
    num(row["comissaria"]) +
    num(row["fbo"]) +
    num(row["slot"]) +
    num(row["outros"]) +
    num(row["variável trip."]) +
    num(row["hospedagem"]) +
    num(row["transporte"]) +
    num(row["comissoes"]) +
    num(row["com.terceiros"])
  );
}

// ==========================
// CAMADA 3 — PREPARAR BASE
// ==========================
function prepararBase(base) {

  const precoMedio = calcularPrecoMedioGlobal(base);

  return base.map(row => {

    const precoLitro = calcularPrecoLitro(row, precoMedio);
    const custo = custoTotalVoo(row, precoLitro);
    const km = num(row["dist_km"]);

    return {
      origem: row.origem,
      destino: row.destino,
      km,
      custo,
      custoKm: km > 0 ? custo / km : 0
    };
  });
}

// ==========================
// CAMADA 4 — AGRUPAR ROTAS
// ==========================
function agruparRotas(base) {

  const rotas = {};

  base.forEach(v => {
    const key = `${v.origem}_${v.destino}`;
    if (!rotas[key]) rotas[key] = [];
    rotas[key].push(v);
  });

  return rotas;
}

// ==========================
// CAMADA 5 — CUSTO POR KM ROTA
// ==========================
function custoKmRota(voos) {

  let totalCusto = 0;
  let totalKm = 0;

  voos.forEach(v => {
    totalCusto += v.custo;
    totalKm += v.km;
  });

  return totalKm > 0 ? totalCusto / totalKm : 0;
}

// ==========================
// CAMADA 6 — FALLBACK DISTÂNCIA
// ==========================
function custoKmSimilar(base, kmRef) {

  const min = kmRef * (1 - SIMILARIDADE_DIST);
  const max = kmRef * (1 + SIMILARIDADE_DIST);

  const similares = base.filter(v =>
    v.km >= min && v.km <= max
  );

  if (similares.length >= MIN_VOOS_SIMILARES) {
    return custoKmRota(similares);
  }

  return null;
}

// ==========================
// CAMADA 7 — GLOBAL
// ==========================
function custoKmGlobal(base) {
  return custoKmRota(base);
}

// ==========================
// CAMADA 8 — OBTER CUSTO TRECHO
// ==========================
function obterCustoKm(basePreparada, rotas, origem, destino, km) {

  const key = `${origem}_${destino}`;

  // 1️⃣ Rota exata
  if (rotas[key]) {
    return custoKmRota(rotas[key]);
  }

  // 2️⃣ Similar por distância
  const similar = custoKmSimilar(basePreparada, km);
  if (similar) return similar;

  // 3️⃣ Global
  return custoKmGlobal(basePreparada);
}

// ==========================
// CAMADA 9 — PRECIFICAÇÃO
// ==========================
function precoSugerido(custo) {
  return custo / (1 - MARGEM_ALVO);
}

function margem(preco, custo) {
  if (preco <= 0) return 0;
  return (preco - custo) / preco;
}

// ==========================
// CAMADA 10 — ENGINE PRINCIPAL
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
    precoUsuario,
    precoIdeal,
    margemReal
  };
}
