// ==========================
// COST ENGINE — BLACK (FIXED)
// ==========================

const MARGEM_ALVO = 0.55;
const SIMILARIDADE_DIST = 0.2;
const MIN_VOOS_SIMILARES = 3;

// ==========================
// UTIL
// ==========================
function num(v) {
  if (v === null || v === undefined || v === "") return 0;

  if (typeof v === "number") return isNaN(v) ? 0 : v;

  let s = String(v).trim();

  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ==========================
// HELPERS
// ==========================
function get(row, nomes) {
  for (const n of nomes) {
    if (row[n] !== undefined) return num(row[n]);
  }
  return 0;
}

// ==========================
// CONVERSÃO
// ==========================
function lbsParaLitros(lbs) {
  return num(lbs) * 0.567;
}

// ==========================
// CUSTO OPERACIONAL (SEM COMBUSTÍVEL)
// ==========================
function custoOperacionalVoo(row) {
  return (
    get(row, ["decea"]) +
    get(row, ["tx.aerop."]) +
    get(row, ["comissaria"]) +
    get(row, ["fbo"]) +
    get(row, ["hospedagem"]) +
    get(row, ["transporte", "Transporte"]) +
    get(row, ["slot"]) +
    get(row, ["outros"]) +
    get(row, ["comissoes"]) +
    get(row, ["variavel trip.", "variável trip."]) +
    get(row, ["com.terceiros"]) +
    get(row, ["mntc.hr"])
  );
}

// ==========================
// PREÇO DO LITRO
// ==========================
function calcularPrecoLitro(linhasTrecho, baseRaw) {
  const validas = linhasTrecho.filter(r =>
    num(r["abast."]) > 0 && num(r["abast.lt."]) > 0
  );

  if (validas.length >= 5) {
    const totalR = validas.reduce((s, r) => s + num(r["abast."]), 0);
    const totalLt = validas.reduce((s, r) => s + num(r["abast.lt."]), 0);
    return totalLt > 0 ? totalR / totalLt : 0;
  }

  const ult30 = baseRaw.slice(-30).filter(r =>
    num(r["abast."]) > 0 && num(r["abast.lt."]) > 0
  );

  const totalR = ult30.reduce((s, r) => s + num(r["abast."]), 0);
  const totalLt = ult30.reduce((s, r) => s + num(r["abast.lt."]), 0);

  return totalLt > 0 ? totalR / totalLt : 0;
}

// ==========================
// COMBUSTÍVEL POR KM
// ==========================
function calcularCombKm(linhasTrecho, precoLitro) {
  let totalR = 0;
  let totalKm = 0;

  linhasTrecho.forEach(r => {
    const litros = lbsParaLitros(r["consm.lbs"]);
    totalR += litros * precoLitro;
    totalKm += num(r["dist_km"]);
  });

  return totalKm > 0 ? totalR / totalKm : 0;
}

// ==========================
// PREPARAR BASE
// ==========================
function prepararBase(base) {
  return base.map(r => ({
    origem: r.origem,
    destino: r.destino,
    km: num(r["dist_km"]),
    custo: custoOperacionalVoo(r),
    raw: r
  })).filter(v => v.origem && v.destino && v.km > 0);
}

// ==========================
// AGRUPAR
// ==========================
function agruparRotas(base) {
  const rotas = {};

  base.forEach(v => {
    const k = `${v.origem}_${v.destino}`;
    if (!rotas[k]) rotas[k] = [];
    rotas[k].push(v);
  });

  return rotas;
}

// ==========================
// CUSTO FINAL KM
// ==========================
function obterCustoKm(basePrep, rotas, baseRaw, origem, destino, kmRef) {
  const key = `${origem}_${destino}`;
  let voos = [];

  if (rotas[key]) {
    voos = rotas[key];
  } else {
    const min = kmRef * (1 - SIMILARIDADE_DIST);
    const max = kmRef * (1 + SIMILARIDADE_DIST);

    voos = basePrep.filter(v => v.km >= min && v.km <= max);
  }

  if (!voos.length) voos = basePrep;

  // estrutural
  const totalCusto = voos.reduce((s, v) => s + v.custo, 0);
  const totalKm = voos.reduce((s, v) => s + v.km, 0);
  const estruturalKm = totalKm > 0 ? totalCusto / totalKm : 0;

  // combustível
  const linhasTrecho = baseRaw.filter(r =>
    r.origem === origem && r.destino === destino
  );

  const precoLt = calcularPrecoLitro(linhasTrecho, baseRaw);
  const combKm = calcularCombKm(linhasTrecho, precoLt);

  return estruturalKm + combKm;
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
// ENGINE
// ==========================
function analisarMissao({ trechos, precoKmUsuario }, baseRaw) {
  const basePrep = prepararBase(baseRaw);
  const rotas = agruparRotas(basePrep);

  let totalKm = 0;
  let totalCusto = 0;

  const resultadoTrechos = trechos.map(t => {
    const custoKm = obterCustoKm(
      basePrep,
      rotas,
      baseRaw,
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
