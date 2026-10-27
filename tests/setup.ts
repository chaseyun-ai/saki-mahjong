import { afterEach } from 'vitest';

// 很多测试是一口气同步跑完的整场模拟。同一个文件里的测试之间只隔着微任务，
// 测试进程收不到主进程的回复，一个文件加起来跑一分钟以上就会报“onTaskUpdate 超时”。
// 每个测试跑完歇一下（让出一次事件循环），好让回复进来。
afterEach(() => new Promise((r) => setTimeout(r, 0)));
