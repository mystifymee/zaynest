import "dotenv/config";
import { 
    InlineKeyboard,
    Bot,
    session,
 } from "grammy";
 
 import type { Context, SessionFlavor } from "grammy";

 import { calculateCleaningPrice} from "./pricing.js"

 
interface SessionData {
    awaitingArea: boolean;
}


 const token = process.env.BOT_TOKEN;

if(!token) {
    throw new Error("Токен бота не найден!");
}


type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(token)

bot.use(session({
    initial: (): SessionData => ({
        awaitingArea: false
    })
}));


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
    ctx.session.awaitingArea = true;
    await ctx.answerCallbackQuery();

    await ctx.reply(
        'Укажите площадь квартиры\n'
    )});

bot.on("message:text", async(ctx) => {
    if(!ctx.session.awaitingArea){
        return
    }

    const area =  Number(ctx.message.text);

    if(!Number.isInteger(area) || area <=0 || area > 1000) {
        await ctx.reply("Введите корректную площадь.");
        return;
    }

    ctx.session.awaitingArea = false;


    await ctx.reply(`Предварительная стоимость: ${calculateCleaningPrice(area, 150)}`)
});






bot.start();