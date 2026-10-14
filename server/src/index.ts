import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;

if(!token) {
    throw new Error("Токен бота не найден!");
}

const bot = new Bot(token);

bot.command("start", async(ctx) =>{
    await ctx.reply("Добро пожаловать в Zaynest!");
});


bot.start();