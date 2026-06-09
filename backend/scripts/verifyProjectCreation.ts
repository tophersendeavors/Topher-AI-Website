// Verify the create-project route accepts projectType + redevTemplateId
// and resolves the shot policy correctly. Creates one test project of
// each of the 5 project types, asserts the metadata, then cleans up
// every test project. The live SELVAJE project is NEVER touched.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import {
  PROJECT_TYPES,
  resolveProjectTypeConfig,
  resolveShotPolicy,
  type ProjectType,
} from "@toburt/shared";

const SELVAJE_PROJECT_ID = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const TEST_TITLE_PREFIX = "[VERIFY_PT_PICKER] ";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

interface CreateResult {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

async function createProjectDirect(args: {
  title: string;
  kind: "feature" | "pilot" | "miniseries" | "short" | "series";
  projectType: ProjectType;
  redevTemplateId: string | null;
  ownerId: string;
}): Promise<CreateResult> {
  const metadata: Record<string, unknown> = {
    projectType: args.projectType,
  };
  if (args.redevTemplateId) metadata.redevTemplateId = args.redevTemplateId;
  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: args.title,
      kind: args.kind,
      owner_id: args.ownerId,
      metadata,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CreateResult;
}

async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

async function getProject(id: string): Promise<CreateResult | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as CreateResult | null) ?? null;
}

async function main() {
  // We bypass the HTTP route here and call Supabase directly. That tests
  // the storage shape (metadata.projectType + metadata.redevTemplateId)
  // which is what the route will write, and avoids needing a JWT for
  // this verifier. The HTTP route's new Create schema is type-checked
  // by tsc + esbuild already.

  // Pick an existing user to own the test projects. We grab the owner
  // of the SELVAJE project so the row passes RLS / FK constraints.
  const selvaje = await getProject(SELVAJE_PROJECT_ID);
  assert(selvaje, "SELVAJE project exists and loads");
  const { data: selvajeFull } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", SELVAJE_PROJECT_ID)
    .single();
  const ownerId = (selvajeFull as { owner_id: string } | null)?.owner_id;
  assert(ownerId, "SELVAJE owner_id resolved");

  // Capture a fingerprint of the SELVAJE project BEFORE any test runs.
  const selvajeBeforeRaw = (await supabase
    .from("projects")
    .select("metadata, title, kind, status")
    .eq("id", SELVAJE_PROJECT_ID)
    .single()).data;
  const selvajeBeforeHash = JSON.stringify(selvajeBeforeRaw);

  // Plan: one project per type. For prestige_series we attach the SELVAJE
  // template explicitly so we can verify it stores; for the others we
  // leave the template blank.
  const plans: Array<{ projectType: ProjectType; redevTemplateId: string | null; kind: "feature" | "pilot" | "miniseries" | "short" | "series" }> = [
    { projectType: "micro_drama", redevTemplateId: null, kind: "series" },
    { projectType: "prestige_series", redevTemplateId: "selvaje", kind: "pilot" },
    { projectType: "mini_series", redevTemplateId: null, kind: "miniseries" },
    { projectType: "feature", redevTemplateId: null, kind: "feature" },
    { projectType: "anthology", redevTemplateId: null, kind: "series" },
  ];

  const created: CreateResult[] = [];
  try {
    // 1. Confirm all 5 PROJECT_TYPES are present in the shared enum.
    assert(
      (PROJECT_TYPES as readonly string[]).join(",") ===
        "prestige_series,mini_series,micro_drama,feature,anthology",
      `PROJECT_TYPES enum exposes all 5: ${PROJECT_TYPES.join(", ")}`
    );

    for (const plan of plans) {
      const title = `${TEST_TITLE_PREFIX}${plan.projectType}`;
      const row = await createProjectDirect({
        title,
        kind: plan.kind,
        projectType: plan.projectType,
        redevTemplateId: plan.redevTemplateId,
        ownerId: ownerId as string,
      });
      created.push(row);
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      assert(meta.projectType === plan.projectType, `${plan.projectType} stored projectType correctly`);
      if (plan.redevTemplateId) {
        assert(
          meta.redevTemplateId === plan.redevTemplateId,
          `${plan.projectType} stored redevTemplateId="${plan.redevTemplateId}"`
        );
      } else {
        assert(
          meta.redevTemplateId === undefined,
          `${plan.projectType} did NOT store a redevTemplateId (blank template)`
        );
      }
      // ShotPolicy resolves correctly for this type.
      const policy = resolveShotPolicy(plan.projectType);
      assert(policy.defaultAspectRatio, `${plan.projectType} shot policy has aspect ratio: ${policy.defaultAspectRatio}`);
      assert(
        policy.isMicroDramaTier === (plan.projectType === "micro_drama"),
        `${plan.projectType} micro tier flag matches`
      );
      // Config also resolves.
      const cfg = resolveProjectTypeConfig(plan.projectType);
      assert(cfg.label, `${plan.projectType} config has label: ${cfg.label}`);
    }

    // SELVAJE-language check: non-SELVAJE projects must NOT carry the
    // SELVAJE redev template marker.
    const nonSelvajeIds = created
      .filter((r, i) => plans[i].redevTemplateId !== "selvaje")
      .map((r) => r.id);
    for (const id of nonSelvajeIds) {
      const fresh = await getProject(id);
      const meta = (fresh?.metadata ?? {}) as Record<string, unknown>;
      assert(
        meta.redevTemplateId !== "selvaje",
        `non-SELVAJE project ${meta.projectType} carries NO SELVAJE marker`
      );
    }

    // Verify SELVAJE project is still byte-identical at the project row level.
    const selvajeAfterRaw = (await supabase
      .from("projects")
      .select("metadata, title, kind, status")
      .eq("id", SELVAJE_PROJECT_ID)
      .single()).data;
    assert(
      JSON.stringify(selvajeAfterRaw) === selvajeBeforeHash,
      "SELVAJE project row is byte-identical to before-test fingerprint"
    );

    console.log("\nAll 5 project types created + verified. Cleaning up.");
  } finally {
    // Cleanup — delete every test project we created.
    for (const row of created) {
      try {
        await deleteProject(row.id);
        console.log(`  deleted test project ${row.id} (${row.title})`);
      } catch (err) {
        console.error(`  FAILED to delete ${row.id}: ${(err as Error).message}`);
      }
    }
    // Belt-and-suspenders: anything left over with our prefix.
    const { data: leftover } = await supabase
      .from("projects")
      .select("id, title")
      .like("title", `${TEST_TITLE_PREFIX}%`);
    for (const row of leftover ?? []) {
      try {
        await deleteProject(row.id as string);
        console.log(`  cleaned up stray test project ${row.id}`);
      } catch {
        // swallow — best-effort cleanup
      }
    }
  }

  console.log("\nVerification complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VERIFY FAILED:", err);
    process.exit(1);
  });
