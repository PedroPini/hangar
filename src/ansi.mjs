export const ESC = "\u001b[";

const colorsEnabled = !process.env.NO_COLOR;
const color = (code, value) => colorsEnabled ? `${ESC}${code}m${value}${ESC}0m` : value;

export const bold = value => color("1", value);
export const dim = value => color("2", value);
export const cyan = value => color("36", value);
export const green = value => color("32", value);
export const yellow = value => color("33", value);
