import "dotenv/config";
import { 
    InlineKeyboard,
    Bot,
    session,
 } from "grammy";
 
 import type { Context, SessionFlavor } from "grammy";

 import { calculateCleaningPrice} from "./pricing.js"

 
interface SessionData {
    selectedService: "maintenance_cleaning" | "deep_cleaning" | null;
    step: "idle" | "awaiting_area" | "awaiting_name";
}


 const token = process.env.BOT_TOKEN;

if(!token) {
    throw new Error("Токен бота не найден!");
}


type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(token)

bot.use(session({
    initial: (): SessionData => ({
        selectedService: null,
        step: "idle"

    })
}));


const keyboard = new InlineKeyboard()
.text("Поддерживающая уборка", "maintenance_cleaning")
.row()
.text("Генеральная уборка", "deep_cleaning");

bot.command("start", async(ctx) =>{
    ctx.session.step = "idle";
    ctx.session.selectedService = null;
    await ctx.reply("Добро пожаловать в Zaynest!");
    await ctx.reply("Выберите услугу:", {
        reply_markup: keyboard,
    });
});

bot.command("cancel", async (ctx) => {
    ctx.session.step = "idle";
    ctx.session.selectedService = null;

    await ctx.reply("Оформление отменено. Выберите услугу", {
        reply_markup: keyboard,
    });
});





bot.callbackQuery("maintenance_cleaning", async (ctx) => {
    ctx.session.step = "awaiting_area";
    ctx.session.selectedService = "maintenance_cleaning";
    await ctx.answerCallbackQuery();
    await ctx.reply(`Укажите площадь квартиры`);
});

bot.callbackQuery("deep_cleaning", async (ctx) => {
    ctx.session.step = "awaiting_area";
    ctx.session.selectedService = "deep_cleaning";
    await ctx.answerCallbackQuery();

    await ctx.reply(
        'Укажите площадь квартиры\n'
    )});

bot.on("message:text", async(ctx) => {
    if(ctx.session.step !== "awaiting_area"){
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
    
    

    
    ctx.session.step = "idle";


    await ctx.reply(`Предварительная стоимость: ${calculateCleaningPrice(area, price)}`)
});






bot.start();