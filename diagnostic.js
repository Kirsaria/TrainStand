const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM7', baudRate: 19200 });

// Функция отправки
function send(cmd, data1 = 0, data2 = 0) {
  const bytes = (data1 || data2) ? 
    [0xDC, 0x04, cmd, data1, data2] : 
    [0xDC, 0x02, cmd];
  
  let sum = 0;
  for (let b of bytes) sum = (sum + b) & 0xFF;
  const lrc = (0 - sum) & 0xFF;
  
  port.write(Buffer.from([...bytes, lrc]));
  console.log(`📤 Отправлено: ${[...bytes, lrc].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
}

// Переменные состояния
let lastGreenButtonState = 0x00; // Байт 3 из предыдущего статуса
let isMoving = false;
let moveDirection = 'none'; // 'left', 'right', 'none'

// Функция для движения до конца
function moveToEnd(direction) {
  if (isMoving) {
    console.log('⚠️ Уже движемся, сначала останавливаем');
    send(0x21); // Остановка
    setTimeout(() => {
      startMovingToEnd(direction);
    }, 200);
  } else {
    startMovingToEnd(direction);
  }
}

function startMovingToEnd(direction) {
  const speed = 500; // Скорость движения
  
  if (direction === 'left') {
    console.log('🚀 Движение влево до конца');
    send(0x01, (speed >> 8) & 0xFF, speed & 0xFF);
    moveDirection = 'left';
  } else if (direction === 'right') {
    console.log('🚀 Движение вправо до конца');
    send(0x02, (speed >> 8) & 0xFF, speed & 0xFF);
    moveDirection = 'right';
  }
  
  isMoving = true;
}

// Обработка ответов
let buffer = Buffer.alloc(0);
port.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  
  while (buffer.length >= 2 && buffer[0] === 0xDC) {
    const length = buffer[1] + 2;
    if (buffer.length >= length) {
      const packet = buffer.slice(0, length);
      console.log(`📥 Ответ: ${Array.from(packet).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
      
      // Если это ответ на команду статуса (0x0B)
      if (packet.length >= 6 && packet[2] === 0x0B) {
        // Байт 3 - это packet[3] (т.к. packet[0]=0xDC, packet[1]=длина, packet[2]=команда)
        const byte3 = packet[3];
        
        // Маска для зеленой кнопки: бит 5 (00100000 = 0x20)
        const greenButtonMask = 0x20;
        const currentGreenButtonState = byte3 & greenButtonMask;
        const lastGreenButtonStateValue = lastGreenButtonState & greenButtonMask;
        
        console.log(`🔍 Байт 3: ${byte3.toString(2).padStart(8, '0')} (0x${byte3.toString(16).toUpperCase().padStart(2, '0')})`);
        console.log(`🟢 Состояние зеленой кнопки: ${currentGreenButtonState ? 'НАЖАТА' : 'ОТПУЩЕНА'}`);
        
        // Проверяем нажатие зеленой кнопки (переход с 0 на 1 в бите 5)
        if (currentGreenButtonState && !lastGreenButtonStateValue) {
          console.log('🎯 Зеленая кнопка нажата!');
          
          // Определяем в какую сторону ехать
          // Если сейчас движемся вправо или не движемся - едем влево
          // Если движемся влево - едем вправо
          const targetDirection = (moveDirection === 'left') ? 'right' : 'left';
          
          // Двигаемся до конца в выбранном направлении
          moveToEnd(targetDirection);
        }
        
        // Сохраняем состояние для следующего сравнения
        lastGreenButtonState = byte3;
        
        // Проверяем концевики (возможно в других битах байта 3)
        // Например, если бит 0 = концевик слева, бит 1 = концевик справа
        const leftEndstop = byte3 & 0x01;
        const rightEndstop = (byte3 >> 1) & 0x01;
        
        console.log(`🏁 Концевик слева: ${leftEndstop ? 'СРАБОТАЛ' : 'НЕ СРАБОТАЛ'}`);
        console.log(`🏁 Концевик справа: ${rightEndstop ? 'СРАБОТАЛ' : 'НЕ СРАБОТАЛ'}`);
        
        // Автоматическая остановка при достижении концевика
        if (isMoving) {
          if (moveDirection === 'left' && leftEndstop) {
            console.log('🛑 Достигнут концевик слева, останавливаемся');
            send(0x21);
            isMoving = false;
            moveDirection = 'none';
          } else if (moveDirection === 'right' && rightEndstop) {
            console.log('🛑 Достигнут концевик справа, останавливаемся');
            send(0x21);
            isMoving = false;
            moveDirection = 'none';
          }
        }
      }
      
      buffer = buffer.slice(length);
    } else {
      break;
    }
  }
});

port.on('open', () => {
  console.log('✅ CONPASS подключен!');
  
  // Запускаем периодический опрос статуса для отслеживания кнопки
  setInterval(() => {
    send(0x0B); // Команда запроса статуса
  }, 100); // Опрашиваем каждые 100 мс
  
  // Получаем аргументы командной строки
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('\nИспользование:');
    console.log('  node script.js команда [параметры]');
    console.log('\nПримеры:');
    console.log('  node script.js status');
    console.log('  node script.js left 500');
    console.log('  node script.js right 300');
    console.log('  node script.js stop');
    console.log('  node script.shutter open');
    console.log('  node script.shutter close');
    console.log('\n🟢 Зеленая кнопка будет отслеживаться автоматически!');
    process.exit(0);
  }
  
  const command = args[0].toLowerCase();
  
  switch(command) {
    case 'status':
      send(0x0B);
      break;
      
    case 'left':
      const speedLeft = parseInt(args[1]) || 500;
      const hiLeft = (speedLeft >> 8) & 0xFF;
      const loLeft = speedLeft & 0xFF;
      send(0x01, hiLeft, loLeft);
      isMoving = true;
      moveDirection = 'left';
      break;
      
    case 'right':
      const speedRight = parseInt(args[1]) || 500;
      const hiRight = (speedRight >> 8) & 0xFF;
      const loRight = speedRight & 0xFF;
      send(0x02, hiRight, loRight);
      isMoving = true;
      moveDirection = 'right';
      break;
      
    case 'stop':
      send(0x21);
      isMoving = false;
      moveDirection = 'none';
      break;
      
    case 'shutter':
      if (args[1] === 'open') {
        send(0x03, 0x00, 0x01);
      } else if (args[1] === 'close') {
        send(0x04, 0x00, 0x01);
      }
      break;
      
    case 'ping':
      send(0x1B);
      break;
      
    default:
      console.log(`❌ Неизвестная команда: ${command}`);
  }
  
  // Не закрываем порт сразу, чтобы слушать кнопку
  console.log('\n👂 Ожидание нажатия зеленой кнопки...');
  console.log('🟢 Когда зеленая кнопка нажата, каретка поедет до конца в противоположную сторону');
});