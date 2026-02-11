export type CoreCommandResponse = {
  status: number;
  stdout: string;
  stderr: string;
};

export type ProjectStatus = {
  found: boolean;
  project_root: string;
};

export type SceneSummary = {
  id: string;
  title: string;
  status: string;
  path: string;
};

export type SceneDetail = {
  id: string;
  title: string;
  summary: string;
  pov: string;
  status: string;
  created_at: string;
  updated_at: string;
  path: string;
  body: string;
};

export type ProposalRecord = {
  id: string;
  title: string;
  instruction: string;
  scene_id: string;
  status: "pending" | "applied" | "rejected";
  created_at: string;
  updated_at: string;
  notes: string;
};
