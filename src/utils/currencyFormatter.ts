export const JPY_RATE = 150;

export const formatCurrency = (valueUsd: number, currency: 'USD' | 'JPY'): string => {
  if (currency === 'USD') {
    return `$${(valueUsd / 1e9).toFixed(2)}B USD`;
  } else {
    const rawValJpy = valueUsd * JPY_RATE;
    if (rawValJpy >= 1e12) {
      const formatted = (rawValJpy / 1e12).toFixed(1);
      return `${formatted.replace('.0', '')}兆円`;
    } else if (rawValJpy >= 1e8) {
      return `${Math.round(rawValJpy / 1e8).toLocaleString()}億円`;
    } else if (rawValJpy >= 1e4) {
      return `${Math.round(rawValJpy / 1e4).toLocaleString()}万円`;
    }
    return `${Math.round(rawValJpy).toLocaleString()}円`;
  }
};
