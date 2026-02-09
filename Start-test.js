const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM7', baudRate: 19200, parity: 'none', databits: 8, stopBits: 1 });
let lastState = {};
let SystemState = {
    isGreenPressed: false,
    isRedPressed: false,
    isRightSensor: false,
    isCenterSensor: false,
    isLeftSensor: false,
    isLightOn: false,
    isMoving: false,
    isEmergency: false,
    scenarioState: 'Idle'
}

// Функция отправки 
function send(cmd, data1 = 0, data2 = 0) {
    if (cmd === 0x0E) {
        bytes = [0xDC, 0x04, cmd, data1, data2];
    }
    else if (data1 !== 0 || data2 !== 0) {
        bytes = [0xDC, 0x04, cmd, data1, data2];
    }
    else {
        bytes = [0xDC, 0x02, cmd];
    }

    let sum = 0;
    for (let b of bytes) sum = (sum + b) & 0xFF;
    const lrc = (0 - sum) & 0xFF;

    port.write(Buffer.from([...bytes, lrc]));
    console.log(`Отправлено: ${[...bytes, lrc].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
}

function moveRight(speed = 500) {
    console.log(`Движение вправо со скоростью: ${speed}`);
    hi = (speed >> 8) & 0xFF;
    lo = speed & 0xFF;
    send(0x02, hi, lo);
}

function moveLeft(speed = 500) {
    console.log(`Движение влево со скоростью: ${speed}`)
    hi = (speed >> 8) & 0xFF;
    lo = speed & 0xFF;
    send(0x01, hi, lo);
}

function turnLight(on) {
    console.log(`${on ? 'Включение' : 'Отключение'} лампы`);
    send(0x0E, on ? 0x01 : 0x00, 0x00);
}

function stopMovement() {
    console.log('Остановка движения');
    send(0x21)
}

// Обработка ответов 
let buffer = Buffer.alloc(0);
port.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);

    while (buffer.length >= 2 && buffer[0] === 0xDC) {
        const length = buffer[1] + 2;
        if (buffer.length >= length) {
            const packet = buffer.slice(0, length);
            if (packet[2] === 0x0B && packet.length >= 7) {
                updateSystemState(packet);
            }
            console.log(`Ответ: ${Array.from(packet).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
            buffer = buffer.slice(length);
        } else break;
    }
});

function updateSystemState(packet) {
    const status1 = packet[3];
    const status2 = packet[4];
    const status3 = packet[5];

    console.log(`СТАТУС (${new Date().toLocaleTimeString()}):`);
    console.log(`Байт 3: ${status1.toString(2).padStart(8, '0')}`);
    console.log(`Байт 4: ${status2.toString(2).padStart(8, '0')}`);
    console.log(`Байт 5: ${status3.toString(2).padStart(8, '0')}`);

    console.log(`Бит 6 (0x40): Красная кнопка = ${(status1 & 0x40) ? '1 (отпущена)' : '0 (нажата)'}`);
    console.log(`Бит 5 (0x20): Зеленая кнопка = ${(status1 & 0x20) ? '1 (отпущена)' : '0 (нажата)'}`);
    console.log(`Бит 4 (0x10): Центральный датчик = ${(status1 & 0x10) ? '1 (открыт)' : '0 (закрыт)'}`);
    console.log(`Бит 0 (0x01) байта 4: Правый датчик = ${(status2 & 0x01) ? '1 (открыт)' : '0 (закрыт)'}`);
    console.log(`Бит 1 (0x02) байта 4: Левый датчик = ${(status2 & 0x02) ? '1 (открыт)' : '0 (закрыт)'}`);

    const newState = {
        isRedPressed: (status1 & 0x40) !== 0,     
        isGreenPressed: (status1 & 0x20) === 0,  
        isCenterSensor: (status1 & 0x10) === 0,    
        isRightSensor: (status2 & 0x01) === 0,        
        isLeftSensor: (status2 & 0x02) === 0,         
        isLightOn: (status3 & 0x01) !== 0
    };


    showChanges(newState);
    Object.assign(SystemState, newState);
    checkScenario();
}

function showChanges(newState) {
    const changes = [];

    if (lastState.isRedPressed !== newState.isRedPressed) {
        changes.push(`Красная кнопка: ${newState.isRedPressed ? 'нажата' : 'отпущена'}`);
    }
    if (lastState.isCenterSensor !== newState.isCenterSensor) {
        changes.push(`Центральный датчик: ${newState.isCenterSensor ? 'закрыт' : 'открыт'}`);
    }
    if (lastState.isLeftSensor !== newState.isLeftSensor) {
        changes.push(`Левый датчик: ${newState.isLeftSensor ? 'закрыт' : 'открыт'}`);
    }
    if (lastState.isLightOn !== newState.isLightOn) {
        changes.push(`Лампа: ${newState.isLightOn ? 'включена' : 'выключена'}`);
    }

    if (lastState.isRightSensor !== newState.isRightSensor) {
        changes.push(`Правый датчик: ${newState.isRightSensor ? 'закрыт' : 'открыт'}`);
    }

    if (lastState.isGreenPressed !== newState.isGreenPressed) {
        changes.push(`Зеленая кнопка: ${newState.isGreenPressed ? 'нажата' : 'отпущена'}`);
    }

    if (changes.length > 0) {
        console.log('\n Изменения:');
        changes.forEach(change => console.log(`  ${change}`));
    }

    lastState = { ...newState };
}

function checkScenario() {
    if (SystemState.isRedPressed) {
        emergencyStop();
        return;
    }

    switch (SystemState.scenarioState) {
        case 'Idle':
            if (SystemState.isGreenPressed) {
                console.log('Зеленая кнопка НАЖАТА - запуск сценария');
                startScenario();
            }
            break;

        case 'Moving':
            if (SystemState.isCenterSensor) {
                console.log('Обнаружен центральный датчик!');
                reachCenter();
            }
            if (SystemState.isRightSensor) {
                console.log('Достигнут конец! Возвращение...');
                returnToStart();
            }
            break;

        case 'Returning':
            if (SystemState.isLeftSensor) {
                console.log('Обнаружен левый датчик - завершение сценария');
                scenarioComplete();
            }
            break;
    }
}

function startScenario() {
    console.log('\n === НАЧАЛО СЦЕНАРИЯ ===');
    console.log('1. Включаю лампу');
    console.log('2. Начинаю движение вправо');

    SystemState.scenarioState = 'Moving';

    turnLight(true);

    setTimeout(() => {
        moveRight(500);
    }, 1000);
}

function reachCenter() {
    console.log('\nДОСТИГНУТА СЕРЕДИНА');
    console.log('1. Выключаю лампу');
    console.log('2. Останавливаюсь');
    console.log('3. Возвращаюсь в начало');

    SystemState.scenarioState = 'Returning';

    turnLight(false);

    stopMovement();

    setTimeout(() => {
        moveLeft(1000);
    }, 500);
}

function returnToStart() {
    console.log('Возвращение в начало');
    SystemState.scenarioState = 'Returning';
    stopMovement();
    setTimeout(() => {
        moveLeft(500);
    }, 500);
}

function scenarioComplete() {
    console.log('\n=== СЦЕНАРИЙ ЗАВЕРШЁН ===');
    console.log('1. Вернулся в начало');
    console.log('2. Полностью остановился');
    console.log('3. Готов к новому запуску\n');

    SystemState.scenarioState = 'Idle';
    stopMovement();
}

function emergencyStop() {
    console.log('Аварийный стоп');
    SystemState.scenarioState = 'Idle';
    stopMovement();
    turnLight(false);
}

port.on('open', () => {
    console.log('CONPASS подключен!');

    setInterval(() => {
        send(0x0B)
    }, 3000);
});