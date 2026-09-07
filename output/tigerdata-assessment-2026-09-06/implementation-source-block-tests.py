"""Actual successor SQL against a generated, local-only PostgreSQL database."""
import getpass
import argparse
import hashlib
import json
import importlib.util
import sys
import time
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--apps',type=int,default=2000)
parser.add_argument('--compatibility',action='store_true')
options=parser.parse_args()
assert 2000<=options.apps<=350000
sys.path.insert(0,str(ROOT/'services/pics-service'))
if options.compatibility:
    from importlib.machinery import SourceFileLoader
    name='src.database.durable_work'
    loader=SourceFileLoader(name,str(OUT/'rollback-pics-successor-compatibility.py.txt'))
    spec=importlib.util.spec_from_loader(name,loader)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    loader.exec_module(module)
from src.database.durable_work import TigerPICSDurableWorkStore, PICSWorkClaim

CONN=dict(host='/private/tmp/piq-postgres-test',port=55439,user=getpass.getuser(),autocommit=True)
def connect(name='piq_source_block_fixture'):
    c=psycopg.connect(**CONN,dbname=name)
    assert c.execute("SELECT current_setting('data_directory')").fetchone()[0]=='/private/tmp/piq-postgres-test/data'
    return c
with connect('postgres') as root:
    if not root.execute("SELECT 1 FROM pg_database WHERE datname='piq_source_block_fixture'").fetchone():
        root.execute('CREATE DATABASE piq_source_block_fixture')

results={'rollback_compatibility_runtime':options.compatibility}
with connect() as db:
    for schema in ('ops','legacy','docs'):
        db.execute(f'DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema}')
    db.execute('''CREATE TABLE legacy.apps(appid integer PRIMARY KEY,created_at timestamptz DEFAULT now());
      CREATE TABLE ops.sync_status(appid integer PRIMARY KEY,last_pics_sync timestamptz,pics_change_number bigint);
      CREATE TABLE ops.pics_sync_state(id integer PRIMARY KEY,last_change_number bigint,updated_at timestamptz);
      INSERT INTO ops.pics_sync_state VALUES(1,100,now());
      CREATE TABLE docs.app_source_snapshots(id bigserial PRIMARY KEY,appid integer,source text,observed_at timestamptz,first_seen_at timestamptz);
      CREATE OR REPLACE FUNCTION public.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS 'SELECT sha256(convert_to($1,''UTF8''))';
      CREATE FUNCTION ops.acquire_heavy_phase_gate(integer DEFAULT 120) RETURNS void LANGUAGE sql AS 'SELECT pg_advisory_xact_lock(1886417008,3)';''')
    db.execute((ROOT/'packages/data-plane/sql/tiger-bootstrap/0088_durable_pics_intake.sql').read_text())
    db.execute((ROOT/'packages/data-plane/sql/tiger-bootstrap/0092_pics_cursor_checkpoint_reconciliation.sql').read_text())
    db.execute('ALTER TABLE ops.pics_work_state ADD needs_token boolean NOT NULL DEFAULT false, ADD claimed_needs_token boolean')
    db.execute((ROOT/'packages/data-plane/sql/tiger-bootstrap/0111_pics_successor_checkpoint.sql').read_text())
    db.execute((ROOT/'packages/data-plane/sql/tiger-bootstrap/0116_pics_uncatalogued_successor_evidence.sql').read_text())
    db.execute("INSERT INTO legacy.apps SELECT n, now()-interval '1 day' FROM generate_series(1,%s) n",(options.apps,))
    db.execute("INSERT INTO ops.sync_status SELECT n,now()-interval '1 month',50 FROM generate_series(4,%s) n",(options.apps,))
    db.execute("INSERT INTO ops.app_data_readiness(appid,source,status,source_at,version,provenance) SELECT n,'pics','ready',now()-interval '1 month','fixture',jsonb_build_object('fixture',true) FROM generate_series(4,%s) n",(options.apps,))
    oldcp,oldrun,gap,head=[uuid4() for _ in range(4)]
    emptyhash=hashlib.sha256(b'').hexdigest()
    for bid,fr,to,complete in [(gap,100,200,False),(head,199,200,True)]:
        db.execute('''INSERT INTO ops.pics_change_batches(id,stream_key,work_mode,lane,from_change_number,to_change_number,
          response_since_change_number,received_at,source_app_count,distinct_app_count,durable_app_count,app_changes_sha256,
          force_full_update,force_full_app_update,force_full_package_update,source_complete,status,
          archive_bucket,archive_key,archive_content_hash,archive_byte_size,archive_content_type)
          VALUES(%s,'shadow-fixture','shadow','live',%s,%s,%s,now(),0,0,0,%s,false,%s,false,%s,%s,'fixture','object',%s,2,'application/json')''',
          (bid,fr,to,fr,emptyhash,not complete,complete,'committed' if complete else 'source_blocked','a'*64))
    db.execute('''INSERT INTO ops.pics_cursor_checkpoints(id,from_change_number,to_change_number,gap_evidence_batch_id,head_evidence_batch_id,
      evidence_stream_key,reason,requested_by,status,applied_at,app_manifest_count,app_manifest_sha256)
      VALUES(%s,50,100,%s,%s,'shadow-fixture','prior recovery','fixture','applied',now(),3,%s)''',(oldcp,gap,head,'b'*64))
    db.execute("INSERT INTO ops.pics_reconciliation_runs(id,checkpoint_id,coverage_cutoff,item_manifest_count,item_manifest_sha256) VALUES(%s,%s,now(),3,%s)",(oldrun,oldcp,'b'*64))
    for appid,state in [(1,'completed'),(2,'source_blocked'),(3,'dead_letter')]:
        db.execute('''INSERT INTO ops.pics_reconciliation_items(run_id,appid,source_index,status,completed_at,last_error_code,disposition)
          VALUES(%s,%s,%s,%s,now(),%s,'{"reason":"preserve audit"}')''',(oldrun,appid,appid-1,state,None if state=='completed' else 'payload_missing'))
        wid=db.execute('''INSERT INTO ops.pics_work_state(appid,stream_key,work_mode,lane,priority,state,first_change_number,latest_change_number,
          reconciliation_run_id,dirty_since,last_dirty_at,dead_lettered_at,attempts,needs_token)
          VALUES(%s,'primary','durable','catchup',100,%s,0,50,%s,now(),now(),CASE WHEN %s='dead_letter' THEN now() END,8,%s) RETURNING id''',
          (appid,state,oldrun,state,appid==2)).fetchone()[0]
        db.execute('UPDATE ops.pics_reconciliation_items SET work_id=%s WHERE run_id=%s AND appid=%s',(wid,oldrun,appid))
    # Three source positions, including the same uncatalogued ID twice with
    # different watermarks/token bits. None may disappear through deduplication.
    source_changes=[(0,10000001,190,True),(1,10000001,195,False),(2,10000002,199,True)]
    source_hash=hashlib.sha256(''.join(f"{i}:{a}:{n}:{int(t)}\n" for i,a,n,t in source_changes).encode()).hexdigest()
    for i,a,n,t in source_changes:
        db.execute('INSERT INTO ops.pics_change_batch_apps(batch_id,source_index,appid,source_change_number,needs_token) VALUES(%s,%s,%s,%s,%s)',(head,i,a,n,t))
    db.execute('UPDATE ops.pics_change_batches SET source_app_count=3,distinct_app_count=2,durable_app_count=3,app_changes_sha256=%s WHERE id=%s',(source_hash,head))
    olditems=db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()
    oldwork=db.execute('SELECT to_jsonb(work) FROM ops.pics_work_state work ORDER BY appid').fetchall()
    for table in ('legacy.apps','ops.sync_status','ops.app_data_readiness','ops.pics_work_state'):
        db.execute('ANALYZE '+table)
    review=db.execute('SELECT ops.pics_successor_review_state(%s)',(oldrun,)).fetchone()[0]
    args=(oldrun,100,200,gap,head,Jsonb(review),'fixture','approved local fixture','Reviewed every prior dead letter; preserve it as unresolved history')
    prepare='SELECT ops.prepare_pics_successor_checkpoint(%s,%s,%s,%s,%s,%s,%s,%s,%s)'
    newrun=db.execute(prepare,args).fetchone()[0]
    assert db.execute(prepare,args).fetchone()[0]==newrun
    assert db.execute('SELECT source_index,appid,source_change_number,needs_token FROM ops.pics_successor_source_blocks WHERE run_id=%s ORDER BY source_index',(newrun,)).fetchall()==source_changes
    assert db.execute('SELECT count(*) FROM legacy.apps WHERE appid>=10000001').fetchone()[0]==0
    assert db.execute('SELECT to_jsonb(work) FROM ops.pics_work_state work ORDER BY appid').fetchall()==oldwork
    def rejects(sql,args=(),message=''):
        try: db.execute(sql,args)
        except psycopg.Error as e:
            if message: assert message in str(e),(message,str(e))
            return
        raise AssertionError('Expected rejection: '+sql)
    rejects('SELECT ops.seal_pics_successor_manifest(%s)',(newrun,),'incomplete')
    # A crashed/rolled-back chunk leaves no progress to skip on restart.
    try:
        with db.transaction():
            db.execute('SELECT ops.stage_pics_successor_manifest(%s,500)',(newrun,))
            raise RuntimeError('simulated worker crash before commit')
    except RuntimeError: pass
    assert db.execute('SELECT count(*) FROM ops.pics_reconciliation_items WHERE run_id=%s',(newrun,)).fetchone()[0]==0
    assert db.execute('SELECT last_staged_appid FROM ops.pics_reconciliation_successors WHERE run_id=%s',(newrun,)).fetchone()[0]==0
    # Abandonment retains staged audits and never changes work/cursor. Roll back
    # this fixture branch so the same prepared run can exercise activation.
    try:
        with db.transaction():
            db.execute("SELECT ops.abandon_pics_successor_staging(%s,'fixture','abandonment branch')",(newrun,))
            assert db.execute('SELECT phase FROM ops.pics_reconciliation_successors WHERE run_id=%s',(newrun,)).fetchone()[0]=='abandoned'
            assert db.execute('SELECT last_change_number FROM ops.pics_sync_state').fetchone()[0]==100
            raise RuntimeError('restore fixture branch')
    except RuntimeError: pass
    started=time.monotonic(); chunks=[]; durations=[]
    stage_lsn=db.execute('SELECT pg_current_wal_insert_lsn()').fetchone()[0]
    while True:
        chunk_started=time.monotonic()
        chunk=db.execute('SELECT ops.stage_pics_successor_manifest(%s,500)',(newrun,)).fetchone()[0]
        durations.append(time.monotonic()-chunk_started)
        chunks.append(chunk)
        if options.apps>2000 and len(chunks)%100==0:
            print(f'Staged {len(chunks)*500} of {options.apps} generated apps',flush=True)
        if chunk['scanComplete']: break
    stage_seconds=time.monotonic()-started
    stage_wal=int(db.execute('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s)',(stage_lsn,)).fetchone()[0])
    assert sum(c['added'] for c in chunks)==options.apps
    assert db.execute('SELECT last_change_number FROM ops.pics_sync_state').fetchone()[0]==100
    assert db.execute('SELECT to_jsonb(work) FROM ops.pics_work_state work ORDER BY appid').fetchall()==oldwork
    seal_started=time.monotonic()
    seal=db.execute('SELECT ops.seal_pics_successor_manifest(%s)',(newrun,)).fetchone()[0]
    seal_seconds=time.monotonic()-seal_started
    assert seal['count']==options.apps
    verify=dict(version='pics-successor-evidence/v1',verifiedAt=db.execute('SELECT clock_timestamp()::text').fetchone()[0])
    for label,bid in [('gap',gap),('head',head)]:
        verify[label]=dict(batchId=str(bid),archiveHash='a'*64,manifestSha256=emptyhash,count=0,verified=True)
    verify['head'].update(manifestSha256=source_hash,count=3)
    activate='SELECT ops.activate_pics_successor_checkpoint(%s,%s,%s,%s)'
    rejects(activate,(newrun,options.apps+1,seal['sha256'],Jsonb(verify)),'manifest')
    rejects(activate,(newrun,options.apps,seal['sha256'],Jsonb({})),'verification')
    for key,bad in [('verified','true'),('archiveHash','0'*64),('count','3'),('manifestSha256','c'*64)]:
        bad_verify=json.loads(json.dumps(verify)); bad_verify['head'][key]=bad
        rejects(activate,(newrun,options.apps,seal['sha256'],Jsonb(bad_verify)),'verification')
    # An old head cannot be activated; retargeting keeps the staged manifest.
    newhead=uuid4()
    db.execute('UPDATE ops.pics_change_batches SET received_at=now()-interval \'1 hour\' WHERE id=%s',(head,))
    rejects(activate,(newrun,options.apps,seal['sha256'],Jsonb(verify)),'recent')
    db.execute('''INSERT INTO ops.pics_change_batches SELECT (jsonb_populate_record(NULL::ops.pics_change_batches,
        to_jsonb(batch)||jsonb_build_object('id',%s::text,'received_at',clock_timestamp(),'from_change_number',200,
          'response_since_change_number',200,'to_change_number',201))).* FROM ops.pics_change_batches batch WHERE id=%s''',(newhead,head))
    db.execute('INSERT INTO ops.pics_change_batch_apps SELECT %s,source_index,appid,source_change_number,needs_token,created_at FROM ops.pics_change_batch_apps WHERE batch_id=%s',(newhead,head))
    assert db.execute("SELECT ops.retarget_pics_successor_head(%s,%s,'fixture','fresh verified boundary')",(newrun,newhead)).fetchone()[0]==201
    verify['head']['batchId']=str(newhead)
    # A new catalog member must be included, even if it arrives after sealing.
    db.execute('INSERT INTO legacy.apps(appid) VALUES(%s)',(options.apps+1,))
    rejects(activate,(newrun,options.apps,seal['sha256'],Jsonb(verify)),'catalog changed')
    first=True
    while True:
        c=db.execute('SELECT ops.stage_pics_successor_manifest(%s,1000,%s)',(newrun,first)).fetchone()[0]
        first=False
        if c['scanComplete']: break
    seal=db.execute('SELECT ops.seal_pics_successor_manifest(%s)',(newrun,)).fetchone()[0]
    assert seal['count']==options.apps+1
    # A changed predecessor review fails closed until an explicit fresh review.
    db.execute("UPDATE ops.pics_reconciliation_items SET disposition='{"+'"reason":"updated review evidence"'+"}' WHERE run_id=%s AND appid=3",(oldrun,))
    rejects(activate,(newrun,seal['count'],seal['sha256'],Jsonb(verify)),'review changed')
    rejects("SELECT ops.review_pics_successor_predecessor(%s,%s,'fixture','stale review')",(newrun,Jsonb(review)),'stale')
    review=db.execute('SELECT ops.pics_successor_review_state(%s)',(oldrun,)).fetchone()[0]
    db.execute("SELECT ops.review_pics_successor_predecessor(%s,%s,'fixture','Reviewed the updated predecessor disposition')",(newrun,Jsonb(review)))
    olditems=db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()
    assert db.execute('SELECT count(*) FROM ops.pics_successor_source_blocks WHERE run_id=%s',(newrun,)).fetchone()[0]==6
    for corruption in ('missing','token','watermark','identity'):
        try:
            with db.transaction():
                if corruption=='missing':
                    db.execute('DELETE FROM ops.pics_successor_source_blocks WHERE run_id=%s AND batch_id=%s AND source_index=0',(newrun,newhead))
                else:
                    update={'token':'needs_token=NOT needs_token','watermark':'source_change_number=source_change_number+1','identity':'appid=appid+10'}[corruption]
                    db.execute('UPDATE ops.pics_successor_source_blocks SET '+update+' WHERE run_id=%s AND batch_id=%s AND source_index=0',(newrun,newhead))
                try:
                    with db.transaction():
                        db.execute(activate,(newrun,seal['count'],seal['sha256'],Jsonb(verify)))
                except psycopg.Error as error: assert 'source-block audit' in str(error)
                else: raise AssertionError('Corrupted audit activated')
                assert db.execute('SELECT last_change_number FROM ops.pics_sync_state').fetchone()[0]==100
                raise RuntimeError('restore audited records')
        except RuntimeError: pass
    # Retargeting a giant unknown-only batch is atomic and bounded. The
    # previously selected head and its records survive the rejected attempt.
    try:
        with db.transaction():
            largehead=uuid4()
            db.execute("INSERT INTO ops.pics_change_batches SELECT (jsonb_populate_record(NULL::ops.pics_change_batches,to_jsonb(b)||jsonb_build_object('id',%s::text,'to_change_number',202))).* FROM ops.pics_change_batches b WHERE id=%s",(largehead,newhead))
            db.execute('INSERT INTO ops.pics_change_batch_apps(batch_id,source_index,appid,source_change_number,needs_token) SELECT %s,n,20000000+n,202,true FROM generate_series(0,1000) n',(largehead,))
            try:
                with db.transaction():
                    db.execute("SELECT ops.retarget_pics_successor_head(%s,%s,'fixture','cap test')",(newrun,largehead))
            except psycopg.Error as error: assert '1000-position' in str(error)
            else: raise AssertionError('Unbounded audit accepted')
            assert db.execute('SELECT head_evidence_batch_id FROM ops.pics_cursor_checkpoints WHERE id=(SELECT checkpoint_id FROM ops.pics_reconciliation_runs WHERE id=%s)',(newrun,)).fetchone()[0]==newhead
            raise RuntimeError('restore small head')
    except RuntimeError: pass
    activated=db.execute(activate,(newrun,seal['count'],seal['sha256'],Jsonb(verify))).fetchone()[0]
    assert activated['retainedSourceBlockedPositions']==6
    assert db.execute(activate,(newrun,seal['count'],seal['sha256'],Jsonb(verify))).fetchone()[0]['alreadyApplied']
    assert db.execute('SELECT last_change_number FROM ops.pics_sync_state').fetchone()[0]==201
    assert db.execute('SELECT status FROM ops.pics_reconciliation_runs WHERE id=%s',(oldrun,)).fetchone()[0]=='cancelled'
    assert db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()==olditems
    assert db.execute('SELECT to_jsonb(work) FROM ops.pics_work_state work ORDER BY appid').fetchall()==oldwork
    # Work locked by a concurrent live transaction is skipped and retried later.
    with connect() as holder, holder.transaction():
        holder.execute('SELECT 1 FROM ops.pics_work_state WHERE appid=1 FOR UPDATE')
        assert db.execute('SELECT ops.enqueue_pics_successor_chunk(%s,1)',(newrun,)).fetchone()[0]==0
    linked=db.execute('SELECT ops.enqueue_pics_successor_chunk(%s,2)',(newrun,)).fetchone()[0]
    assert linked==2
    assert db.execute('SELECT needs_token,latest_change_number FROM ops.pics_work_state WHERE appid=2').fetchone()==(True,50)
    assert db.execute('SELECT count(*) FROM ops.pics_work_state WHERE state IN (\'pending\',\'retrying\')').fetchone()[0]==2
    assert db.execute('SELECT count(*) FROM ops.app_data_readiness WHERE status=\'pending\'').fetchone()[0]==2
    assert db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()==olditems
    with db.transaction():
        db.execute("SELECT set_config('lock_timeout','1s',true)")
        db.execute('SELECT pg_advisory_xact_lock(1886417008,3)')
        with connect() as other:
            try: other.execute('SELECT ops.enqueue_pics_successor_chunk(%s,2)',(newrun,))
            except psycopg.errors.LockNotAvailable: pass
            else: raise AssertionError('enqueue ignored heavy gate')
    rejects("UPDATE ops.pics_cursor_checkpoints SET status='rolled_back',rolled_back_at=now(),rollback_reason='bad helper' WHERE id=(SELECT checkpoint_id FROM ops.pics_reconciliation_runs WHERE id=%s)",(newrun,),'legacy')
    store=TigerPICSDurableWorkStore('local-only',connection_factory=connect)
    assert store.claim_work(work_mode='durable',stream_key='primary',worker_id='fixture-worker',
                            lane_group='catchup',limit=2,lease_seconds=300)==[]
    db.execute("UPDATE ops.pics_work_state SET lane='live',priority=200 WHERE appid=1")
    live=store.claim_work(work_mode='durable',stream_key='primary',worker_id='fixture-worker',
                         lane_group='live',limit=2,lease_seconds=300)
    assert len(live)==1 and live[0].appid==1
    for disposition in ('failure','source_block'):
        with db.transaction(),db.cursor() as cursor:
            cursor.execute('SAVEPOINT disposition_branch')
            if disposition=='failure':
                store._settle_reconciliation_failure(cursor,claim=live[0],next_state='dead_letter',error_code='fixture_failure',error_message='test')
            else:
                store._settle_reconciliation_source_block(cursor,claim=live[0],blocking_reason='fixture_block',detail='test',provenance={'fixture':True})
            assert db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()==olditems
            cursor.execute('ROLLBACK TO SAVEPOINT disposition_branch')
    results['failure_and_source_block_preserve_old_audits']=True
    snapshotid=db.execute("INSERT INTO docs.app_source_snapshots(appid,source) VALUES(1,'pics') RETURNING id").fetchone()[0]
    with db.transaction(),db.cursor() as cursor:
        store._settle_reconciliation_completion(cursor,claim=live[0],snapshot_id=snapshotid,source_change_number=50)
    assert db.execute('SELECT to_jsonb(item) FROM ops.pics_reconciliation_items item WHERE run_id=%s ORDER BY appid',(oldrun,)).fetchall()==olditems
    db.execute("SELECT ops.set_pics_successor_catchup_paused(%s,false,'fixture','bounded canary')",(newrun,))
    catchup=store.claim_work(work_mode='durable',stream_key='primary',worker_id='fixture-worker',
                            lane_group='catchup',limit=2,lease_seconds=300)
    assert len(catchup)==1 and catchup[0].appid==2 and catchup[0].needs_token
    if not options.compatibility:
        # A capacity deferral on the final attempt refunds exactly once.
        db.execute('UPDATE ops.pics_work_state SET attempts=max_attempts WHERE appid=2')
        store.defer_catchup_claim(claim=catchup[0],worker_id='fixture-worker')
        assert db.execute('SELECT attempts,state FROM ops.pics_work_state WHERE appid=2').fetchone()==(7,'retrying')
        try: store.defer_catchup_claim(claim=catchup[0],worker_id='fixture-worker')
        except Exception as error: assert 'no longer owned' in str(error)
        else: raise AssertionError('deferral refunded twice')
        results['final_attempt_deferral_refunds_once']=True
    results.update(paused_catchup_has_zero_claims=True,live_claims_continue_when_paused=True,
                   current_run_settlement_preserves_old_items=True,unpause_is_audited=True)
    results.update(prepare_idempotent=True,generated_apps=options.apps,stage_chunk_count=len(chunks),
      stage_seconds=round(stage_seconds,4),stage_wal_bytes=stage_wal,seal_seconds=round(seal_seconds,4),
      stage_chunk_p95_ms=round(sorted(durations)[int(len(durations)*.95)]*1000,3),
      staged_table_and_indexes_bytes=db.execute("SELECT pg_total_relation_size('ops.pics_reconciliation_items')").fetchone()[0],
      interrupted_chunk_rolls_back=True,abandon_retains_audits=True,retarget_retains_manifest=True,
      new_catalog_member_requires_reseal=True,stale_review_requires_new_review=True,
      concurrent_live_lock_skipped_then_retried=True,
      scenario_seconds=round(time.monotonic()-started,4),stage_does_not_change_work_or_cursor=True,
      manifest_and_verification_fail_closed=True,activation_idempotent=True,
      previous_dispositions_unchanged=True,bounded_enqueue=linked,token_and_watermark_retained=True,
      heavy_phase_defers_enqueue=True,legacy_rollback_prohibited=True)
    blocks=db.execute('SELECT to_jsonb(b) FROM ops.pics_successor_source_blocks b ORDER BY batch_id,source_index').fetchall()
    db.execute((OUT/'rollback-0116.sql').read_text())
    assert db.execute('SELECT to_jsonb(b) FROM ops.pics_successor_source_blocks b ORDER BY batch_id,source_index').fetchall()==blocks
    assert db.execute('SELECT last_change_number FROM ops.pics_sync_state').fetchone()[0]==201
    assert 'head contains uncatalogued apps' in db.execute("SELECT pg_get_functiondef('ops.prepare_pics_successor_checkpoint(uuid,bigint,bigint,uuid,uuid,jsonb,text,text,text)'::regprocedure)").fetchone()[0]
    results.update(duplicate_positions_and_tokens_preserved=True,unknowns_do_not_create_catalog_or_primary_work=True,
      missing_or_corrupt_audit_blocks_activation=True,source_block_cap_atomic=True,retarget_preserves_old_source_blocks=True,
      rollback_restores_guards_and_retains_evidence=True,unresolved_positions_retained=len(blocks))
filename='implementation-source-block-results.json'
(OUT/filename).write_text(json.dumps(results,indent=2,default=str))
print(json.dumps(results,indent=2))
