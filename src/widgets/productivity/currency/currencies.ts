/**
 * 160 currencies: ISO code, English name and the countries/words people search with.
 * Names in the user's language come from Intl.DisplayNames when available.
 */
export interface Currency {
  code: string;
  name: string;
  /** Countries, regions and common words (lower case), for search. */
  words: string[];
}

const RAW = `AED|UAE Dirham|united arab emirates,uae,dubai,abu dhabi,emirates
AFN|Afghan Afghani|afghanistan
ALL|Albanian Lek|albania
AMD|Armenian Dram|armenia
ANG|Netherlands Antillean Guilder|curacao,sint maarten,antilles
AOA|Angolan Kwanza|angola
ARS|Argentine Peso|argentina
AUD|Australian Dollar|australia,aussie,kiribati,nauru,tuvalu
AWG|Aruban Florin|aruba
AZN|Azerbaijani Manat|azerbaijan
BAM|Bosnia-Herzegovina Mark|bosnia,herzegovina,convertible mark
BBD|Barbadian Dollar|barbados
BDT|Bangladeshi Taka|bangladesh
BGN|Bulgarian Lev|bulgaria
BHD|Bahraini Dinar|bahrain
BIF|Burundian Franc|burundi
BMD|Bermudan Dollar|bermuda
BND|Brunei Dollar|brunei
BOB|Bolivian Boliviano|bolivia
BRL|Brazilian Real|brazil,reais
BSD|Bahamian Dollar|bahamas
BTN|Bhutanese Ngultrum|bhutan
BWP|Botswanan Pula|botswana
BYN|Belarusian Ruble|belarus,rouble
BZD|Belize Dollar|belize
CAD|Canadian Dollar|canada,loonie
CDF|Congolese Franc|congo,drc,kinshasa
CHF|Swiss Franc|switzerland,swiss,liechtenstein
CLP|Chilean Peso|chile
CNY|Chinese Yuan|china,renminbi,rmb,yuan
COP|Colombian Peso|colombia
CRC|Costa Rican Colon|costa rica
CUP|Cuban Peso|cuba
CVE|Cape Verdean Escudo|cape verde,cabo verde
CZK|Czech Koruna|czech republic,czechia,crown
DJF|Djiboutian Franc|djibouti
DKK|Danish Krone|denmark,greenland,faroe islands
DOP|Dominican Peso|dominican republic
DZD|Algerian Dinar|algeria
EGP|Egyptian Pound|egypt
ERN|Eritrean Nakfa|eritrea
ETB|Ethiopian Birr|ethiopia
EUR|Euro|eurozone,europe,germany,france,italy,spain,netherlands,belgium,austria,ireland,portugal,finland,greece,slovakia,slovenia,estonia,latvia,lithuania,luxembourg,malta,cyprus,croatia,montenegro,kosovo,andorra,monaco,san marino,vatican
FJD|Fijian Dollar|fiji
FKP|Falkland Islands Pound|falkland islands
GBP|British Pound|united kingdom,uk,britain,england,scotland,wales,sterling,pound
GEL|Georgian Lari|georgia
GHS|Ghanaian Cedi|ghana
GIP|Gibraltar Pound|gibraltar
GMD|Gambian Dalasi|gambia
GNF|Guinean Franc|guinea
GTQ|Guatemalan Quetzal|guatemala
GYD|Guyanaese Dollar|guyana
HKD|Hong Kong Dollar|hong kong
HNL|Honduran Lempira|honduras
HTG|Haitian Gourde|haiti
HUF|Hungarian Forint|hungary
IDR|Indonesian Rupiah|indonesia,bali
ILS|Israeli New Shekel|israel,palestine,shekel
INR|Indian Rupee|india,rupee
IQD|Iraqi Dinar|iraq
IRR|Iranian Rial|iran
ISK|Icelandic Krona|iceland
JMD|Jamaican Dollar|jamaica
JOD|Jordanian Dinar|jordan
JPY|Japanese Yen|japan,yen
KES|Kenyan Shilling|kenya
KGS|Kyrgystani Som|kyrgyzstan
KHR|Cambodian Riel|cambodia
KMF|Comorian Franc|comoros
KPW|North Korean Won|north korea
KRW|South Korean Won|south korea,korea,won
KWD|Kuwaiti Dinar|kuwait
KYD|Cayman Islands Dollar|cayman islands
KZT|Kazakhstani Tenge|kazakhstan
LAK|Laotian Kip|laos
LBP|Lebanese Pound|lebanon
LKR|Sri Lankan Rupee|sri lanka
LRD|Liberian Dollar|liberia
LSL|Lesotho Loti|lesotho
LYD|Libyan Dinar|libya
MAD|Moroccan Dirham|morocco,western sahara
MDL|Moldovan Leu|moldova
MGA|Malagasy Ariary|madagascar
MKD|Macedonian Denar|north macedonia,macedonia
MMK|Myanmar Kyat|myanmar,burma
MNT|Mongolian Tugrik|mongolia
MOP|Macanese Pataca|macau,macao
MRU|Mauritanian Ouguiya|mauritania
MUR|Mauritian Rupee|mauritius
MVR|Maldivian Rufiyaa|maldives
MWK|Malawian Kwacha|malawi
MXN|Mexican Peso|mexico
MYR|Malaysian Ringgit|malaysia
MZN|Mozambican Metical|mozambique
NAD|Namibian Dollar|namibia
NGN|Nigerian Naira|nigeria
NIO|Nicaraguan Cordoba|nicaragua
NOK|Norwegian Krone|norway
NPR|Nepalese Rupee|nepal
NZD|New Zealand Dollar|new zealand,kiwi,cook islands
OMR|Omani Rial|oman
PAB|Panamanian Balboa|panama
PEN|Peruvian Sol|peru
PGK|Papua New Guinean Kina|papua new guinea
PHP|Philippine Peso|philippines
PKR|Pakistani Rupee|pakistan
PLN|Polish Zloty|poland
PYG|Paraguayan Guarani|paraguay
QAR|Qatari Riyal|qatar
RON|Romanian Leu|romania
RSD|Serbian Dinar|serbia
RUB|Russian Ruble|russia,rouble
RWF|Rwandan Franc|rwanda
SAR|Saudi Riyal|saudi arabia
SBD|Solomon Islands Dollar|solomon islands
SCR|Seychellois Rupee|seychelles
SDG|Sudanese Pound|sudan
SEK|Swedish Krona|sweden
SGD|Singapore Dollar|singapore
SHP|St. Helena Pound|saint helena
SLE|Sierra Leonean Leone|sierra leone
SOS|Somali Shilling|somalia
SRD|Surinamese Dollar|suriname
SSP|South Sudanese Pound|south sudan
STN|Sao Tome and Principe Dobra|sao tome,principe
SYP|Syrian Pound|syria
SZL|Swazi Lilangeni|eswatini,swaziland
THB|Thai Baht|thailand,baht
TJS|Tajikistani Somoni|tajikistan
TMT|Turkmenistani Manat|turkmenistan
TND|Tunisian Dinar|tunisia
TOP|Tongan Pa'anga|tonga
TRY|Turkish Lira|turkey,turkiye
TTD|Trinidad and Tobago Dollar|trinidad,tobago
TWD|New Taiwan Dollar|taiwan
TZS|Tanzanian Shilling|tanzania
UAH|Ukrainian Hryvnia|ukraine
UGX|Ugandan Shilling|uganda
USD|US Dollar|united states,usa,america,ecuador,el salvador,puerto rico,dollar,buck
UYU|Uruguayan Peso|uruguay
UZS|Uzbekistani Som|uzbekistan,sum
VES|Venezuelan Bolivar|venezuela
VND|Vietnamese Dong|vietnam,viet nam
VUV|Vanuatu Vatu|vanuatu
WST|Samoan Tala|samoa
XAF|Central African CFA Franc|cameroon,chad,gabon,central african republic,equatorial guinea,republic of the congo,cfa
XCD|East Caribbean Dollar|antigua,dominica,grenada,saint lucia,saint kitts,saint vincent,anguilla,montserrat
XOF|West African CFA Franc|senegal,ivory coast,cote d'ivoire,mali,burkina faso,niger,togo,benin,guinea-bissau,cfa
XPF|CFP Franc|french polynesia,new caledonia,wallis
YER|Yemeni Rial|yemen
ZAR|South African Rand|south africa,rand
ZMW|Zambian Kwacha|zambia
ZWL|Zimbabwean Dollar|zimbabwe
GGP|Guernsey Pound|guernsey
IMP|Manx Pound|isle of man
JEP|Jersey Pound|jersey
KID|Kiribati Dollar|kiribati
TVD|Tuvaluan Dollar|tuvalu
FOK|Faroese Krona|faroe islands
XDR|Special Drawing Rights|imf,sdr`;

export const CURRENCIES: Currency[] = RAW.split("\n").map((line) => {
  const [code, name, words] = line.split("|");
  return { code, name, words: words.split(",").map((w) => w.trim()) };
});

const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): Currency | undefined {
  return byCode.get(code.toUpperCase());
}

let displayNames: Intl.DisplayNames | null | undefined;
/** The currency's name in the user's language, falling back to English. */
export function currencyName(code: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(undefined, { type: "currency" });
    } catch {
      displayNames = null;
    }
  }
  try {
    const n = displayNames?.of(code);
    if (n && n !== code) return n;
  } catch {
    /* unknown code */
  }
  return byCode.get(code)?.name ?? code;
}

// ---- search -------------------------------------------------------------------------------------

/** Damerau-Levenshtein (optimal string alignment) distance, capped for speed. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Lower score = better. Infinity = no match. */
function score(c: Currency, q: string, localName: string): number {
  const code = c.code.toLowerCase();
  if (q === code) return 0;
  if (code.startsWith(q)) return 1;
  const names = [fold(c.name), fold(localName)];
  const words = [...names, ...c.words];
  if (names.some((n) => n.startsWith(q))) return 2;
  if (c.words.some((w) => w.startsWith(q))) return 2.5;
  if (words.some((w) => w.includes(q))) return 3;
  if (q.length < 3) return Infinity;
  const cap = q.length >= 7 ? 2 : 1;
  let best = Infinity;
  for (const phrase of words) {
    for (const token of [phrase, ...phrase.split(/[\s-]+/)]) {
      // Compare with the token's prefix of the same length, so partial words also match.
      const cand = token.length > q.length + 1 ? token.slice(0, q.length) : token;
      const dist = editDistance(q, cand, cap);
      if (dist <= cap) best = Math.min(best, 4 + dist);
    }
  }
  return best;
}

/** Currencies matching `query` by code, name, country or a near miss ("dolar", "jpan"). */
export function searchCurrencies(query: string, limit = 40): Currency[] {
  const q = fold(query.trim());
  if (!q) return CURRENCIES;
  return CURRENCIES.map((c) => ({ c, s: score(c, q, currencyName(c.code)) }))
    .filter((x) => x.s < Infinity)
    .sort((a, b) => a.s - b.s || a.c.code.localeCompare(b.c.code))
    .slice(0, limit)
    .map((x) => x.c);
}

/** A flag emoji from the currency's country code (first two letters), when it is one. */
export function currencyFlag(code: string): string {
  if (code === "EUR") return String.fromCodePoint(0x1f1ea, 0x1f1fa);
  if (code.startsWith("X")) return String.fromCodePoint(0x1f310);
  const cc = code.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
