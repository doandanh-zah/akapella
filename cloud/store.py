"""Private R2 objects. A random, short-lived job ID is a bearer capability."""

from datetime import UTC, datetime
import json
import os
import time
import secrets

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

MAX_BYTES = 50_000_000
UPLOAD_TTL = 300
JOB_TTL = 3600
DAILY_LIMIT = 20


class Store:
    def __init__(self):
        self.bucket = os.environ["R2_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", request_checksum_calculation="when_required"),
        )

    def args(self, job, filename):
        return {"Bucket": self.bucket, "Key": f"akapella/{job}/{filename}"}

    def read(self, job, filename):
        try:
            response = self.client.get_object(**self.args(job, filename))
        except ClientError as exc:
            if exc.response["ResponseMetadata"]["HTTPStatusCode"] == 404:
                return None
            raise
        with response["Body"] as body:
            return json.load(body)

    def write(self, job, filename, payload, *, once=False):
        condition = {"IfNoneMatch": "*"} if once else {}
        try:
            self.client.put_object(
                **self.args(job, filename), **condition,
                Body=json.dumps(payload).encode(), ContentType="application/json",
            )
        except ClientError as exc:
            if once and exc.response["ResponseMetadata"]["HTTPStatusCode"] == 412:
                return False
            raise
        return True

    def reserve_daily_slot(self):
        day = datetime.now(UTC).date().isoformat()
        start = secrets.randbelow(DAILY_LIMIT)
        return any(
            self.write(f"quota/{day}", f"{(start + index) % DAILY_LIMIT}.json", {}, once=True)
            for index in range(DAILY_LIMIT)
        )

    def size(self, job):
        try:
            result = self.client.head_object(**self.args(job, "input"))
        except ClientError as exc:
            if exc.response["ResponseMetadata"]["HTTPStatusCode"] == 404:
                return None
            raise
        return result["ContentLength"]

    def upload_url(self, job, size):
        return self.client.generate_presigned_url(
            "put_object",
            Params={**self.args(job, "input"), "ContentLength": size,
                    "ContentType": "application/octet-stream", "IfNoneMatch": "*"},
            ExpiresIn=UPLOAD_TTL,
        )

    def download_url(self, job, name):
        return self.client.generate_presigned_url(
            "get_object", Params=self.args(job, f"{name}.wav"), ExpiresIn=600,
        )

    def fetch_input(self, job, path):
        self.client.download_file(self.bucket, self.args(job, "input")["Key"], str(path))

    def upload_output(self, job, name, path):
        self.client.upload_file(
            str(path), self.bucket, self.args(job, f"{name}.wav")["Key"],
            ExtraArgs={"ContentType": "audio/wav",
                       "ContentDisposition": f'attachment; filename="{name}.wav"'},
        )

    def state(self, job, stage, **fields):
        return self.write(job, "state.json", {"stage": stage, "at": time.time(), **fields})
