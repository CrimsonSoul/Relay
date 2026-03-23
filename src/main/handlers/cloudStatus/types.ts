export type RssItem = {
  title: string;
  description: string;
  pubDate: string;
  link: string;
  guid: string;
  status: string;
};

export type StatuspageIncident = {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink: string;
  created_at: string;
  updated_at: string;
  incident_updates: { body: string; created_at: string }[];
};

export type GoogleCloudIncident = {
  id: string;
  external_desc: string;
  begin: string;
  end?: string;
  modified: string;
  status_impact: string;
  uri: string;
  most_recent_update?: { text: string; when: string };
};

export type SalesforceIncident = {
  id: number;
  status: string;
  type: string;
  createdAt: string;
  updatedAt?: string;
  serviceKeys: string[];
  IncidentEvents?: { message: string; createdAt: string }[];
  timeline?: { content: string; createdAt?: string }[];
};
