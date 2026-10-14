import "dotenv/config";
import { InlineKeyboard, Bot } from "grammy";
import { calculateCleaningPrice} from "./pricing.js"

const token = process.env.BOT_TOKEN;

if(!token) {
    throw new Error("Токен бота не найден!");
}

const bot = new Bot(token);

const keyboard = new InlineKeyboard()
.text("Поддерживающая уборка", "maintenance_cleaning")
.row()
.text("Генеральная уборка", "deep_cleaning");

bot.command("start", async(ctx) =>{
    await ctx.reply("Добро пожаловать в Zaynest!");
    await ctx.reply("Выберите услугу:", {
        reply_markup: keyboard,
    });
});




bot.callbackQuery("maintenance_cleaning", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Вы выбрали поддерживающую уборку!");
});

bot.callbackQuery("deep_cleaning", async (ctx) => {
    await ctx.answerCallbackQuery();
    const total = calculateCleaningPrice(60, 150);

    await ctx.reply(
        'Вы выбрали генеральную уборку!\n' +
        `Площадь: ${60} м^2\n` +
        `Предварительная стоимость: ${total} руб.`
    );

});






bot.start();