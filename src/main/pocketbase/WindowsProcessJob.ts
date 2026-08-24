import koffi from 'koffi';

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_TERMINATE_AND_SET_QUOTA = 0x0101;

export type WindowsProcessJob = {
  assign: (pid: number) => boolean;
  close: () => void;
};

export type WindowsJobBindings = {
  createJobObject: () => unknown;
  setInformationJobObject: (
    job: unknown,
    informationClass: number,
    information: Record<string, unknown>,
    informationSize: number,
  ) => boolean;
  openProcess: (access: number, inheritHandle: boolean, pid: number) => unknown;
  assignProcessToJobObject: (job: unknown, process: unknown) => boolean;
  closeHandle: (handle: unknown) => boolean;
  informationSize: number;
};

type KoffiApi = Pick<typeof koffi, 'load' | 'sizeof' | 'struct'>;

function validHandle(handle: unknown): boolean {
  return handle !== null && handle !== undefined && handle !== 0 && handle !== 0n;
}

export function bindWindowsKillOnCloseJob(bindings: WindowsJobBindings): WindowsProcessJob {
  const job = bindings.createJobObject();
  if (!validHandle(job)) throw new Error('Windows could not create a PocketBase Job Object');

  const information = {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0,
      PerJobUserTimeLimit: 0,
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      MinimumWorkingSetSize: 0,
      MaximumWorkingSetSize: 0,
      ActiveProcessLimit: 0,
      Affinity: 0,
      PriorityClass: 0,
      SchedulingClass: 0,
    },
    IoInfo: {
      ReadOperationCount: 0,
      WriteOperationCount: 0,
      OtherOperationCount: 0,
      ReadTransferCount: 0,
      WriteTransferCount: 0,
      OtherTransferCount: 0,
    },
    ProcessMemoryLimit: 0,
    JobMemoryLimit: 0,
    PeakProcessMemoryUsed: 0,
    PeakJobMemoryUsed: 0,
  };
  if (
    !bindings.setInformationJobObject(
      job,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
      information,
      bindings.informationSize,
    )
  ) {
    bindings.closeHandle(job);
    throw new Error('Windows could not configure the PocketBase Job Object');
  }

  let closed = false;
  return {
    assign: (pid) => {
      if (closed || !Number.isSafeInteger(pid) || pid <= 0) return false;
      const processHandle = bindings.openProcess(PROCESS_TERMINATE_AND_SET_QUOTA, false, pid);
      if (!validHandle(processHandle)) return false;
      try {
        return bindings.assignProcessToJobObject(job, processHandle);
      } finally {
        bindings.closeHandle(processHandle);
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      bindings.closeHandle(job);
    },
  };
}

function createKoffiBindings(native: KoffiApi): WindowsJobBindings {
  const basicLimits = native.struct('RELAY_JOBOBJECT_BASIC_LIMIT_INFORMATION', {
    PerProcessUserTimeLimit: 'int64_t',
    PerJobUserTimeLimit: 'int64_t',
    LimitFlags: 'uint32_t',
    MinimumWorkingSetSize: 'uintptr_t',
    MaximumWorkingSetSize: 'uintptr_t',
    ActiveProcessLimit: 'uint32_t',
    Affinity: 'uintptr_t',
    PriorityClass: 'uint32_t',
    SchedulingClass: 'uint32_t',
  });
  const ioCounters = native.struct('RELAY_IO_COUNTERS', {
    ReadOperationCount: 'uint64_t',
    WriteOperationCount: 'uint64_t',
    OtherOperationCount: 'uint64_t',
    ReadTransferCount: 'uint64_t',
    WriteTransferCount: 'uint64_t',
    OtherTransferCount: 'uint64_t',
  });
  const extendedLimits = native.struct('RELAY_JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
    BasicLimitInformation: basicLimits,
    IoInfo: ioCounters,
    ProcessMemoryLimit: 'uintptr_t',
    JobMemoryLimit: 'uintptr_t',
    PeakProcessMemoryUsed: 'uintptr_t',
    PeakJobMemoryUsed: 'uintptr_t',
  });
  const kernel32 = native.load('kernel32.dll');
  return {
    createJobObject: kernel32
      .func('void * __stdcall CreateJobObjectW(void *lpJobAttributes, str16 lpName)')
      .bind(null, null, null),
    setInformationJobObject: kernel32.func(
      'bool __stdcall SetInformationJobObject(void *hJob, int informationClass, RELAY_JOBOBJECT_EXTENDED_LIMIT_INFORMATION *information, uint32_t informationLength)',
    ) as WindowsJobBindings['setInformationJobObject'],
    openProcess: kernel32.func(
      'void * __stdcall OpenProcess(uint32_t desiredAccess, bool inheritHandle, uint32_t processId)',
    ) as WindowsJobBindings['openProcess'],
    assignProcessToJobObject: kernel32.func(
      'bool __stdcall AssignProcessToJobObject(void *hJob, void *hProcess)',
    ) as WindowsJobBindings['assignProcessToJobObject'],
    closeHandle: kernel32.func(
      'bool __stdcall CloseHandle(void *handle)',
    ) as WindowsJobBindings['closeHandle'],
    informationSize: native.sizeof(extendedLimits),
  };
}

let koffiBindings: WindowsJobBindings | null = null;

export function createWindowsKillOnCloseJob(): WindowsProcessJob {
  koffiBindings ??= createKoffiBindings(koffi);
  return bindWindowsKillOnCloseJob(koffiBindings);
}
