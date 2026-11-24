import assert from "node:assert/strict";
import test from "node:test";
import { formatBookingDate, parseArea, parseBookingDate, parseName, parsePhone, services } from "../src/booking.js";
import { availableTimes, currentMoscowDay, datePageStart, dateView, resolveSlot, shiftDay, timeView } from "../src/calendar.js";
import { calculateCleaningPrice } from "../src/pricing.js";

test("площадь и действующие тарифы", () => {
    assert.equal(parseArea(" 42 "), 42);
    assert.equal(parseArea("1000"), 1000);
    for (const input of ["", "0", "-1", "1001", "1.5", "1e2", "0x10", "10\n20"]) {
        assert.equal(parseArea(input), null, input);
    }
    assert.equal(calculateCleaningPrice(42, services.maintenance_cleaning.price), 3360);
    assert.equal(calculateCleaningPrice(42, services.deep_cleaning.price), 6300);
});

test("имя и телефон для ручного ввода и контакта", () => {
    assert.equal(parseName("  Анна-Мария О’Коннор "), "Анна-Мария О’Коннор");
    for (const input of ["А", "Иван123", "Анна\nМария", "А".repeat(51), "-Анна"]) {
        assert.equal(parseName(input), null, input);
    }
    assert.equal(parsePhone("+7 (900) 123-45-67"), "+79001234567");
    assert.equal(parsePhone("79001234567"), "+79001234567");
    assert.equal(parsePhone("+90 (555) 900-67-81"), "+905559006781");
    assert.equal(parsePhone("905559006781"), "+905559006781");
    assert.equal(parsePhone("00905559006781"), "+905559006781");
    assert.equal(parsePhone("+1 213 373 4253"), "+12133734253");
    for (const input of ["123", "5559006781", "9001234567", "02079460958", "+999123456789", "+70000000000", "++79001234567", "79001234567\n00", "79001234567 доб. 9"]) {
        assert.equal(parsePhone(input), null, input);
    }
});

test("московское время, календарь и границы будущего", () => {
    const now = new Date("2027-12-31T20:59:59.999Z");
    const expected = "2027-12-31T21:00:00.000Z";
    assert.equal(parseBookingDate("01.01.2028 00:00", now)?.toISOString(), expected);
    assert.equal(formatBookingDate(new Date(expected)), "01.01.2028 00:00");
    assert.equal(parseBookingDate("01.01.2028 00:00", new Date(expected)), null);
    assert.ok(parseBookingDate("29.02.2028 23:59", now));
    for (const input of ["31.12.2027 23:59", "31.04.2028 12:00", "29.02.2029 12:00", "01.05.2028 24:00",
        "01.05.2028 09:60", "00.05.2028 09:00", "02.13.2028 10:00", "01/01/2028 12:30"]) {
        assert.equal(parseBookingDate(input, now), null, input);
    }
});

test("страницы по 12 дат в трёх колонках переходят через месяц и год", () => {
    const now = new Date("2027-12-30T06:00:00Z");
    const first = datePageStart(undefined, now);
    const rows = dateView(first, "key", now).keyboard.inline_keyboard;
    assert.deepEqual(rows.map(row => row.length), [3, 3, 3, 3, 1, 1]);
    assert.deepEqual(rows[0]?.map(button => button.text), ["Чт 30.12", "Пт 31.12", "Сб 01.01"]);
    const next = shiftDay(first, 12);
    assert.equal(next, "2028-01-11");
    assert.equal(shiftDay(next, -12), first);
    assert.equal(shiftDay(first, 12 * 10), "2028-04-28");
    assert.deepEqual(dateView(next, "key", now).keyboard.inline_keyboard[4]?.map(button => button.text), ["Раньше", "Позже"]);
    assert.equal(shiftDay("2028-02-28", 1), "2028-02-29");
});

test("прошедшие дни и время отсечены по МСК, границы времени включены", () => {
    const now = new Date("2028-02-29T06:00:00Z");
    assert.equal(resolveSlot("2028-02-28", "19:00", now), null);
    assert.equal(resolveSlot("2028-02-29", "09:00", now), null);
    assert.equal(resolveSlot("2028-02-29", "09:30", now)?.toISOString(), "2028-02-29T06:30:00.000Z");
    assert.equal(availableTimes("2028-03-01", now).length, 21);
    assert.equal(availableTimes("2028-03-01", now).at(0), "09:00");
    assert.equal(availableTimes("2028-03-01", now).at(-1), "19:00");
    for (const time of ["08:30", "09:15", "19:30", "9:00"]) {
        assert.equal(resolveSlot("2028-03-01", time, now), null);
    }
    assert.equal(resolveSlot("2028-02-30", "09:30", now), null);
    const end = new Date("2028-02-29T16:00:00Z");
    assert.deepEqual(availableTimes("2028-02-29", end), []);
    assert.equal(currentMoscowDay(new Date("2028-02-29T21:00:00Z")), "2028-03-01");
    assert.equal(datePageStart("2028-02-28", end), "2028-03-01");
    const timeRows = timeView("2028-03-01", "key", end).keyboard.inline_keyboard;
    assert.deepEqual(timeRows.map(row => row.length), [3, 3, 3, 3, 3, 3, 3, 2]);
    assert.deepEqual(timeView("2028-02-29", "key", end).keyboard.inline_keyboard[0]?.map(button => button.text), ["Назад", "Отмена"]);
});
