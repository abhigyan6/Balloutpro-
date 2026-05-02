export enum DecisionStatus {
  IDLE = 'idle',
  UPLOADING = 'uploading',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed'
}

export enum Verdict {
  OUT = 'OUT',
  NOT_OUT = 'NOT OUT',
  UMPIRES_CALL = 'UMPIRE\'S CALL'
}

export interface DRSDecision {
  id: string;
  timestamp: string;
  type: 'LBW' | 'Run-out' | 'Edge Detection';
  verdict: Verdict;
  details: {
    pitching?: string;
    impact?: string;
    wickets?: string;
    frame?: number;
  };
}
