const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM7', baudRate: 19200, parity: 'none', databits: 8, stopBits: 1 });
let lastState = {};
let scenarioTimeouts = [];
let lastScenarioStartTime = 0;
const SCENARIO_COOLDOWN_MS = 1000;

let SystemState = {
    isGreenPressed: false,
    isRedPressed: false,
    isRightSensor: false,
    isCenterSensor: false,
    isLeftSensor: false,
    isLightOn: false,
    isMoving: false,
    isEmergency: false,
    scenarioState: 'Idle',
    scenarioActive: false,
    lastScenarioCompleteTime: 0 
}

// Функция отправки 
function send(cmd, data1 = 0, data2 = 0) {
    let bytes;
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

function moveRight(speed = 300) {
    console.log(`Движение вправо со скоростью: ${speed}`);
    SystemState.isMoving = true;
    const hi = (speed >> 8) & 0xFF;
    const lo = speed & 0xFF;
    send(0x02, hi, lo);
}

function moveLeft(speed = 300) {
    console.log(`Движение влево со скоростью: ${speed}`)
    SystemState.isMoving = true;
    const hi = (speed >> 8) & 0xFF;
    const lo = speed & 0xFF;
    send(0x01, hi, lo);
}

function turnLight(on) {
    console.log(`${on ? 'Включение' : 'Отключение'} лампы`);
    SystemState.isLightOn = on;
    send(on ? 0x03 : 0x04, 0x00, 0x01);
}

function stopMovement() {
    console.log('Остановка движения');
    SystemState.isMoving = false;
    send(0x21);
}

function clearAllTimeouts() {
    scenarioTimeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
    });
    scenarioTimeouts = [];
}

function addTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
        const index = scenarioTimeouts.indexOf(timeoutId);
        if (index > -1) {
            scenarioTimeouts.splice(index, 1);
        }
        callback();
    }, delay);

    scenarioTimeouts.push(timeoutId);
    return timeoutId;
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
    console.log(`Бит 4 (0x10): Центральный датчик = ${(status1 & 0x10) ? '1 (каретка НАД датчиком)' : '0 (каретка НЕ над датчиком)'}`);
    console.log(`Бит 0 (0x01) байта 4: Правый датчик = ${(status2 & 0x01) ? '1 (каретка НАД датчиком)' : '0 (каретка НЕ над датчиком)'}`);
    console.log(`Бит 1 (0x02) байта 4: Левый датчик = ${(status2 & 0x02) ? '1 (каретка НАД датчиком)' : '0 (каретка НЕ над датчиком)'}`);

    const newState = {
        isRedPressed: (status1 & 0x40) !== 0,
        isGreenPressed: (status1 & 0x20) === 0,
        isCenterSensor: (status1 & 0x10) !== 0,
        isRightSensor: (status2 & 0x01) !== 0,
        isLeftSensor: (status2 & 0x02) !== 0,
        isLightOn: (status3 & 0x01) !== 0
    };

    showChanges(newState);
    const prevState = { ...SystemState };
    Object.assign(SystemState, newState);
    checkScenario(prevState);
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

function checkScenario(prevState) {
    if (SystemState.isRedPressed && !SystemState.isEmergency) {
        emergencyStop();
        return;
    }

    if (!SystemState.isRedPressed && SystemState.isEmergency) {
        console.log('Красная кнопка отпущена - выход из аварийного режима');
        SystemState.isEmergency = false;
        resetScenarioState();
        return;
    }

    if (SystemState.isEmergency) {
        return;
    }

    const greenButtonJustPressed = !prevState.isGreenPressed && SystemState.isGreenPressed;

    switch (SystemState.scenarioState) {
        case 'Idle':
            if (greenButtonJustPressed && !SystemState.scenarioActive) {
                console.log('Зеленая кнопка НАЖАТА - запуск сценария');
                startScenario();
            }
            break;

        case 'MovingToCenter':
            if (SystemState.isCenterSensor) {
                console.log('Обнаружен центральный датчик!');
                reachCenter();
            }
            if (SystemState.isRightSensor) {
                console.log('Достигнут конец! Возвращение');
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

function resetScenarioState() {
    console.log('Сброс состояния сценария');
    SystemState.scenarioState = 'Idle';
    SystemState.scenarioActive = false;
    SystemState.isMoving = false;
}

function startScenario() {
    const now = Date.now();
    
    if (now - lastScenarioStartTime < SCENARIO_COOLDOWN_MS || 
        now - SystemState.lastScenarioCompleteTime < SCENARIO_COOLDOWN_MS) {
        console.log('Сценарий уже запущен или недавно завершен, игнорирую нажатие');
        return;
    }

    lastScenarioStartTime = now;
    
    console.log('\n === НАЧАЛО СЦЕНАРИЯ ===');
    SystemState.scenarioState = 'MovingToCenter';
    SystemState.scenarioActive = true;

    clearAllTimeouts();

    turnLight(true); 

    if (SystemState.isLeftSensor) {
        console.log('Каретка на левом датчике - двигаю вправо');
        addTimeout(() => moveRight(300), 300);
    } else if (SystemState.isRightSensor) {
        console.log('Каретка на правом датчике - двигаю влево');
        addTimeout(() => moveLeft(300), 300);
    } else if (SystemState.isCenterSensor) {
        console.log('Каретка уже на центральном датчике');
        addTimeout(() => reachCenter(), 100);
    } else {
        console.log('Каретка между датчиками - двигаю вправо');
        addTimeout(() => moveRight(300), 300);
    }
}

function reachCenter() {
    console.log('\nДОСТИГНУТА СЕРЕДИНА');
    SystemState.scenarioState = 'Returning';

    addTimeout(() => {
        stopMovement();

        addTimeout(() => {
            if (SystemState.isLeftSensor) {
                console.log('Уже на левом датчике - стоп');
                scenarioComplete();
            } else {
                console.log('Двигаюсь к левому датчику');
                moveLeft(300);
            }
        }, 100);
    }, 100);
}

function returnToStart() {
    console.log('Возвращение в начало (из правого датчика)');
    SystemState.scenarioState = 'Returning';

    addTimeout(() => {
        stopMovement();

        addTimeout(() => {
            console.log('Двигаюсь к левому датчику');
            moveLeft(300);
        }, 100);
    }, 100);
}

function scenarioComplete() {
    console.log('\n=== СЦЕНАРИЙ ЗАВЕРШЁН ===');
    SystemState.scenarioState = 'Idle';
    SystemState.scenarioActive = false;
    SystemState.lastScenarioCompleteTime = Date.now(); 
    
    addTimeout(() => {
        stopMovement();
        console.log('Готов к новому сценарию');
    }, 50);
}

function emergencyStop() {
    console.log('\n!!! АВАРИЙНЫЙ СТОП !!!');
    SystemState.scenarioState = 'Idle';
    SystemState.scenarioActive = false;
    SystemState.isEmergency = true; 
    SystemState.lastScenarioCompleteTime = Date.now();  

    clearAllTimeouts();
    stopMovement();
    turnLight(false); 
}

port.on('error', (err) => {
    console.error('Ошибка порта:', err.message);
    clearAllTimeouts();
});

port.on('close', () => {
    console.log('Порт закрыт');
    clearAllTimeouts();
});

port.on('open', () => {
    console.log('CONPASS подключен!');
    console.log('Ожидание нажатия зеленой кнопки...');

    setInterval(() => {
        send(0x0B)
    }, 300);
});