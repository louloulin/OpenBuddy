export interface WeKnoraKnowledgeBaseEntry {
  id: string;
  name: string;
  type?: string;
  description?: string;
  tenantId?: number;
  updatedAt?: string;
}

export interface WeKnoraStatus {
  configured: boolean;
  reason?: string;
}

export interface WeKnoraReference {
  id?: string;
  content?: string;
  knowledgeId?: string;
  knowledgeTitle?: string;
  score?: number;
}

export interface WeKnoraAnswer {
  sessionId: string;
  answer: string;
  references: WeKnoraReference[];
}
