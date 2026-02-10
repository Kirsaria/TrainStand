const { SerialPort } = require('serialport');
const readline = require('readline');

// Конфигурация порта
const port = new SerialPort({
    path: 'COM7',
    baudRate: 19200,
    parity: 'none',
    dataBits: 8,
    stopBits: 1
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Функция отправки команды
function sendCommand(cmd, data1 = 0, data2 = 0) {
    let bytes;
    
    if (data1 !== 0 || data2 !== 0) {
        bytes = [0xDC, 0x04, cmd, data1, data2];
    } else {
        bytes = [0xDC, 0x02, cmd];
    }
    
    // Рассчитываем LRC
    let sum = 0;
    for (let b of bytes) {
        sum = (sum + b) & 0xFF;
    }
    const lrc = (0 - sum) & 0xFF;
    
    const packet = [...bytes, lrc];
    port.write(Buffer.from(packet));
    
    console.log('\n📤 ОТПРАВЛЕНО:');
    console.log('HEX:', packet.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    console.log('DEC:', packet.join(' '));
    console.log(`CMD: 0x${cmd.toString(16).toUpperCase()} (${cmd})`);
    if (data1 !== 0 || data2 !== 0) {
        console.log(`Data1: 0x${data1.toString(16).toUpperCase()} (${data1})`);
        console.log(`Data2: 0x${data2.toString(16).toUpperCase()} (${data2})`);
    }
    
    return packet;
}

// Тестируем различные команды для лампы
function testLampCommands() {
    console.log('\n🔍 ТЕСТИРУЮ КОМАНДЫ ДЛЯ ЛАМПЫ:');
    
    // Попробуем разные команды из документации
    const testCommands = [
        { name: 'Команда 13 - Таймер X-RAY (1)', cmd: 0x0D, data1: 1, data2: 0 },
        { name: 'Команда 13 - Таймер X-RAY (0)', cmd: 0x0D, data1: 0, data2: 0 },
        { name: 'Команда 14 - Фонари (1)', cmd: 0x0E, data1: 1, data2: 0 },
        { name: 'Команда 14 - Фонари (0)', cmd: 0x0E, data1: 0, data2: 0 },
        { name: 'Команда 3 - Открыть шторку', cmd: 0x03, data1: 0, data2: 0 },
        { name: 'Команда 4 - Закрыть шторку', cmd: 0x04, data1: 0, data2: 0 },
        { name: 'Команда 12 - Настройки (без шторок)', cmd: 0x0C, data1: 0x81, data2: 0 },
        { name: 'Команда 27 - Подтверждение', cmd: 0x1B, data1: 0, data2: 0 },
    ];
    
    let index = 0;
    
    const sendNextCommand = () => {
        if (index >= testCommands.length) {
            console.log('\n✅ Все команды отправлены');
            setTimeout(() => mainMenu(), 1000);
            return;
        }
        
        const test = testCommands[index];
        console.log(`\n${index + 1}. ${test.name}`);
        sendCommand(test.cmd, test.data1, test.data2);
        
        index++;
        setTimeout(sendNextCommand, 2000);
    };
    
    sendNextCommand();
}

// Запрос статуса
function checkStatus() {
    console.log('\n📊 ЗАПРОС СТАТУСА');
    sendCommand(0x0B);
}

// Анализ статуса
function parseStatus(packet) {
    if (packet[2] !== 0x0B || packet.length < 8) return;
    
    const data1 = packet[3];  // DATA1
    const data2 = packet[4];  // DATA2  
    const data3 = packet[5];  // DATA3
    const data4 = packet[6];  // DATA4
    
    console.log('\n📋 АНАЛИЗ СТАТУСА:');
    console.log('DATA1 (байт 3):', data1.toString(2).padStart(8, '0'), `(0x${data1.toString(16).toUpperCase()})`);
    console.log('DATA2 (байт 4):', data2.toString(2).padStart(8, '0'), `(0x${data2.toString(16).toUpperCase()})`);
    console.log('DATA3 (байт 5):', data3.toString(2).padStart(8, '0'), `(0x${data3.toString(16).toUpperCase()})`);
    console.log('DATA4 (байт 6):', data4.toString(2).padStart(8, '0'), `(0x${data4.toString(16).toUpperCase()})`);
    
    // Кнопки (по предыдущему коду)
    const isRedPressed = (data3 & 0x02) !== 0;  // Бит 1: Кнопка СТОП на столе
    const isGreenPressed = (data3 & 0x04) !== 0; // Бит 2: Кнопка СТОП на портале
    
    console.log('\n🎮 КНОПКИ:');
    console.log(`Красная (стоп): ${isRedPressed ? 'НАЖАТА' : 'ОТПУЩЕНА'}`);
    console.log(`Зеленая: ${isGreenPressed ? 'НАЖАТА' : 'ОТПУЩЕНА'}`);
    
    // Датчики
    console.log('\n📡 ДАТЧИКИ:');
    console.log(`Platform sensor 1 (бит 5): ${(data1 & 0x20) ? '1 (каретка НАД)' : '0 (каретка НЕ над)'}`);
    console.log(`Platform sensor 2 (бит 6): ${(data1 & 0x40) ? '1 (каретка НАД)' : '0 (каретка НЕ над)'}`);
    console.log(`Limit switch 2 (бит 1 DATA2): ${(data2 & 0x02) ? '1' : '0'}`);
}

// Тестирование с зеленой кнопкой
function testWithGreenButton() {
    console.log('\n🎯 ТЕСТ С ЗЕЛЕНОЙ КНОПКОЙ:');
    console.log('1. Нажмите зеленую кнопку');
    console.log('2. Смотрите статус системы');
    console.log('3. Проверяем все биты статуса\n');
    
    let checkCount = 0;
    const maxChecks = 20;
    
    const checkInterval = setInterval(() => {
        checkStatus();
        checkCount++;
        
        if (checkCount >= maxChecks) {
            clearInterval(checkInterval);
            console.log('\n✅ Тест завершен');
            setTimeout(() => mainMenu(), 1000);
        }
    }, 500);
    
    // Остановка по команде
    rl.question('\nНажмите Enter для остановки теста...', () => {
        clearInterval(checkInterval);
        console.log('Тест остановлен');
        setTimeout(() => mainMenu(), 500);
    });
}

// Основное меню
function mainMenu() {
    console.log('\n========================================');
    console.log('     УПРАВЛЕНИЕ ЛАМПОЙ CONPASS');
    console.log('========================================');
    console.log('\n1 - Тест всех команд для лампы');
    console.log('2 - Запрос статуса');
    console.log('3 - Тест с зеленой кнопкой');
    console.log('4 - Отправить свою команду');
    console.log('5 - Проверить движение каретки');
    console.log('exit - Выход');
    console.log('\n========================================\n');
    
    rl.question('Выберите действие: ', (choice) => {
        switch(choice.trim()) {
            case '1':
                testLampCommands();
                break;
            case '2':
                checkStatus();
                setTimeout(() => mainMenu(), 1500);
                break;
            case '3':
                testWithGreenButton();
                break;
            case '4':
                customCommand();
                break;
            case '5':
                testCarriageMovement();
                break;
            case 'exit':
                console.log('Выход...');
                rl.close();
                port.close();
                return;
            default:
                console.log('Неверный выбор');
                setTimeout(() => mainMenu(), 500);
        }
    });
}

// Отправка своей команды
function customCommand() {
    console.log('\n✏️  ОТПРАВКА СВОЕЙ КОМАНДЫ:');
    console.log('Формат: команда data1 data2');
    console.log('Пример: 14 1 0 - включить фонари');
    console.log('Пример: 13 1 0 - включить таймер X-RAY\n');
    
    rl.question('Введите команду: ', (input) => {
        const parts = input.trim().split(/\s+/);
        if (parts.length >= 1) {
            const cmd = parseInt(parts[0]);
            const data1 = parts.length >= 2 ? parseInt(parts[1]) : 0;
            const data2 = parts.length >= 3 ? parseInt(parts[2]) : 0;
            
            console.log(`Отправка: cmd=${cmd}, data1=${data1}, data2=${data2}`);
            sendCommand(cmd, data1, data2);
        }
        setTimeout(() => mainMenu(), 1500);
    });
}

// Тест движения каретки
function testCarriageMovement() {
    console.log('\n🚗 ТЕСТ ДВИЖЕНИЯ КАРЕТКИ:');
    console.log('1. Движение влево (скорость 100)');
    console.log('2. Движение вправо (скорость 100)');
    console.log('3. Стоп');
    console.log('4. Назад\n');
    
    rl.question('Выберите: ', (choice) => {
        switch(choice.trim()) {
            case '1':
                console.log('Движение влево...');
                sendCommand(0x01, 0x00, 100);
                setTimeout(() => testCarriageMovement(), 1000);
                break;
            case '2':
                console.log('Движение вправо...');
                sendCommand(0x02, 0x00, 100);
                setTimeout(() => testCarriageMovement(), 1000);
                break;
            case '3':
                console.log('Стоп...');
                sendCommand(0x21);
                setTimeout(() => testCarriageMovement(), 1000);
                break;
            case '4':
                mainMenu();
                break;
            default:
                console.log('Неверный выбор');
                setTimeout(() => testCarriageMovement(), 500);
        }
    });
}

// Обработка входящих данных
let buffer = Buffer.alloc(0);

port.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    
    while (buffer.length >= 2 && buffer[0] === 0xDC) {
        const length = buffer[1] + 2;
        
        if (buffer.length >= length) {
            const packet = buffer.slice(0, length);
            buffer = buffer.slice(length);
            
            console.log('\n📥 ОТВЕТ:');
            console.log('HEX:', Array.from(packet).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
            
            // Анализируем команду
            const cmd = packet[2];
            console.log(`Команда: 0x${cmd.toString(16).toUpperCase()} (${cmd})`);
            
            if (cmd === 0x0B) {
                parseStatus(packet);
            }
        } else {
            break;
        }
    }
});

// Запуск
port.on('open', () => {
    console.log('✅ Порт COM7 открыт');
    mainMenu();
});

port.on('error', (err) => {
    console.error('❌ Ошибка:', err.message);
});

rl.on('close', () => {
    console.log('\n👋 Программа завершена');
    process.exit(0);
});