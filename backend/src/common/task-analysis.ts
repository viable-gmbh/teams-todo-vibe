export type TaskPriority = 'p1' | 'p2' | 'p3' | 'p4';

export interface TaskAnalysisResult {
  isTask: boolean;
  taskText: string;
  priority: TaskPriority;
  due: string | null;
  assignee: string | null;
}
