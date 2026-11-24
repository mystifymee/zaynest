import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const services = {
    maintenance_cleaning: { name: "Поддерживающая уборка", price: 80 },
    deep_cleaning: { name: "Генеральная уборка", price: 150 },
};

export type Service = keyof typeof services;

export type Draft =
    | { step: "area"; service: Service }
    | { step: "name"; service: Service; area: number }
    | { step: "phone"; service: Service; area: number; name: string }
    | { step: "date"; service: Service; area: number; name: string; phone: string; pageStart?: string }
    | { step: "time"; service: Service; area: number; name: string; phone: string; day: string; pageStart?: string }
    | { step: "confirm"; service: Service; area: number; name: string; phone: string; date: string };

export function parseArea(text: string): number | null {
    const value = text.trim();
    if (!/^\d{1,4}$/.test(value)) return null;
    const area = Number(value);
    return area >= 1 && area <= 1000 ? area : null;
}

export function parseName(text: string): string | null {
    const name = text.trim().normalize("NFC");
    if (name.length < 2 || name.length > 50 || !/^\p{L}[\p{L}\p{M}]*(?:[ '’\-]\p{L}[\p{L}\p{M}]*)*$/u.test(name)) {
        return null;
    }
    return name;
}

export function parsePhone(text: string): string | null {
    const input = text.trim();
    if (!/^\+?[0-9\p{Zs}().-]+$/u.test(input)) return null;

    const digits = input.replace(/\D/g, "");
    const hasPrefix = input.startsWith("+") || input.startsWith("00");
    // Short unprefixed numbers can be national numbers. Never infer a default country.
    if (!hasPrefix && digits.length <= 10) return null;
    const international = "+" + (input.startsWith("00") ? digits.slice(2) : digits);
    const phone = parsePhoneNumberFromString(international, { extract: false });
    if (!phone?.isValid() || (!hasPrefix && phone.number !== international)) return null;
    return phone.number;
}

const moscow = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const moscowOffset = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow", timeZoneName: "longOffset",
});

export function formatBookingDate(date: Date): string {
    return moscow.format(date).replace(",", "");
}

export function parseBookingDate(text: string, now = new Date()): Date | null {
    const input = text.trim();
    const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(input);
    if (!match) return null;
    const [, day, month, year, hour, minute] = match;
    const localTime = `${year}-${month}-${day}T${hour}:${minute}:00`;
    const utc = new Date(`${localTime}Z`);
    if (Number.isNaN(utc.getTime())) return null;
    const offset = moscowOffset.formatToParts(utc).find(part => part.type === "timeZoneName")?.value;
    const candidate = new Date(`${localTime}${offset?.replace("GMT", "") || "Z"}`);
    return candidate > now && formatBookingDate(candidate) === input ? candidate : null;
}
