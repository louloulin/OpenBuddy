/**
 * MailRail stories — left rail with 3 AI views + folder drawer.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { MailRail } from "../components/MailRail";
import type { RailAccount, RailCounts, RailFolder, RailView } from "../components/MailRail";
import { useState } from "react";

interface RailProps {
  accounts: RailAccount[];
  accountId: string;
  counts: RailCounts;
}

function RailShell(props: { accounts: Array<{ id: string; address: string; name?: string; status: "connected" | "disconnected"; unread?: number }>; accountId: string; counts: { today: number; later: number; done: number; inbox: number; drafts: number; scheduled: number; snoozed: number; starred?: number } }): JSX.Element {
  const [view, setView] = useState<RailView>("today");
  const [folder, setFolder] = useState<RailFolder>("inbox");
  return (
    <MailRail
      accounts={props.accounts}
      accountId={props.accountId}
      view={view}
      folder={folder}
      counts={props.counts}
      onAccountChange={() => undefined}
      onViewChange={setView}
      onFolderChange={setFolder}
      onOpenSettings={() => undefined}
    />
  );
}

const meta: Meta<{ accounts: Array<{ id: string; address: string; name?: string; status: "connected" | "disconnected"; unread?: number }>; accountId: string; counts: { today: number; later: number; done: number; inbox: number; drafts: number; scheduled: number; snoozed: number; starred?: number } }> = {
  title: "Email AI/MailRail",
  component: RailShell,
  args: {
    accounts: [{ id: "a1", address: "me@openbuddy.ai", name: "Work", status: "connected" }],
    accountId: "a1",
    counts: { today: 5, later: 12, done: 0, inbox: 17, drafts: 2, scheduled: 0, snoozed: 3 },
  },
};

type Story = StoryObj;

export const Default: Story = {};

export const ManyInbox: Story = {
  args: { counts: { today: 23, later: 84, done: 12, inbox: 119, drafts: 4, scheduled: 1, snoozed: 7 } },
};

export const Disconnected: Story = {
  args: {
    accounts: [{ id: "a1", address: "me@openbuddy.ai", status: "disconnected" }],
  },
};

export default meta;
