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
    selectedService: "maintenance_cleaning" | "deep_cleaning" | null;
}


 const token = process.env.BOT_TOKEN;

if(!token) {
    throw new Error("Токен бота не найден!");
}


type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(token)

bot.use(session({
    initial: (): SessionData => ({
        awaitingArea: false,
        selectedService: null
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
    ctx.session.awaitingArea = true;
    ctx.session.selectedService = "maintenance_cleaning";
    await ctx.answerCallbackQuery();
    await ctx.reply(`Укажите площадь квартиры`);
});

bot.callbackQuery("deep_cleaning", async (ctx) => {
    ctx.session.awaitingArea = true;
    ctx.session.selectedService = "deep_cleaning";
    await ctx.answerCallbackQuery();

    await ctx.reply(
        'Укажите площадь квартиры\n'
    )});

bot.on("message:text", async(ctx) => {
    if(!ctx.session.awaitingArea){
        return
    }


    const service = ctx.session.selectedService

    if(service === null){
        await ctx.reply("Нужно выбрать услугу");
        return;
    }

    let price: number;
    if(service === "maintenance_cleaning") {
        price = 80;
    } else {
        price = 150;
    }

    const area =  Number(ctx.message.text);


    if(!Number.isInteger(area) || area <=0 || area > 1000) {
        await ctx.reply("Введите корректную площадь.");
        return;
    }


    

    ctx.session.awaitingArea = false;


    await ctx.reply(`Предварительная стоимость: ${calculateCleaningPrice(area, price)}`)
});






bot.start();