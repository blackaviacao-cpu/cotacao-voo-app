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
  if (!v) return 0;

  const limpo = String(v)
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const n = parseFloat(limpo);

  return isNaN(n) ? 0 : n;
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

function valorCampo(row, nomes) {
  for (const nome of nomes) {
    if (row[nome] !== undefined) return num(row[nome]);
  }
  return 0;
}

function auditarLinhaCusto(row, precoMedioGlobal) {
  const precoLitro = calcularPrecoLitro(row, precoMedioGlobal);
  const litrosConsumidos = lbsToLitros(row["consm.lbs"]);
  const combustivel = custoCombustivel(row, precoLitro);

  const item = {
    origem: row.origem,
    destino: row.destino,
    km: num(row["dist_km"]),
    tempo: num(row["tempo"]),

    litrosConsumidos,
    precoLitro,
    combustivel,

    decea: num(row["decea"]),
    taxaAeroportuaria: num(row["tx.aerop."]),
    comissaria: num(row["comissaria"]),
    fbo: num(row["fbo"]),
    slot: num(row["slot"]),
    outros: num(row["outros"]),
    variavelTrip: valorCampo(row, ["variavel trip.", "variável trip."]),
    hospedagem: num(row["hospedagem"]),
    transporte: num(row["transporte"]),
    comissoes: num(row["comissoes"]),
    comTerceiros: num(row["com.terceiros"]),
    manutencao: num(row["mntc.hr"])
  };

  item.total =
    item.combustivel +
    item.decea +
    item.taxaAeroportuaria +
    item.comissaria +
    item.fbo +
    item.slot +
    item.outros +
    item.variavelTrip +
    item.hospedagem +
    item.transporte +
    item.comissoes +
    item.comTerceiros +
    item.manutencao;

  item.custoKm = item.km > 0 ? item.total / item.km : 0;

  return item;
}

function auditarCustoTrecho(baseRaw, origem, destino, kmRef) {
  const precoMedioGlobal = calcularPrecoMedioGlobal(baseRaw);

  let linhas = baseRaw.filter(r =>
    r.origem === origem && r.destino === destino
  );

  let criterio = "ROTA EXATA";

  if (!linhas.length) {
    const min = kmRef * (1 - SIMILARIDADE_DIST);
    const max = kmRef * (1 + SIMILARIDADE_DIST);

    linhas = baseRaw.filter(r =>
      num(r["dist_km"]) >= min && num(r["dist_km"]) <= max
    );

    criterio = "DISTÂNCIA SIMILAR";
  }

  const auditoria = linhas.map(r => auditarLinhaCusto(r, precoMedioGlobal));

  const totalCusto = auditoria.reduce((s, r) => s + r.total, 0);
  const totalKm = auditoria.reduce((s, r) => s + r.km, 0);
  const custoKmPonderado = totalKm > 0 ? totalCusto / totalKm : 0;

  console.group(`AUDITORIA ${origem} → ${destino} | ${criterio}`);
  console.table(auditoria);
  console.log("TOTAL CUSTO HISTÓRICO:", totalCusto);
  console.log("TOTAL KM HISTÓRICO:", totalKm);
  console.log("CUSTO R$/KM PONDERADO:", custoKmPonderado);
  console.log("KM DO TRECHO COTADO:", kmRef);
  console.log("CUSTO ESTIMADO DO TRECHO:", custoKmPonderado * kmRef);
  console.groupEnd();

  return {
    criterio,
    auditoria,
    totalCusto,
    totalKm,
    custoKmPonderado,
    custoEstimadoTrecho: custoKmPonderado * kmRef
  };
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
    num(row["variavel trip."]) +
    num(row["hospedagem"]) +
    num(row["transporte"]) +
    num(row["comissoes"]) +
    num(row["com.terceiros"]) +
    num(row["mntc.hr"])
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
