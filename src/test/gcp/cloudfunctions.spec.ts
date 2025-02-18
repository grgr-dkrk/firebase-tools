import { expect } from "chai";
import * as nock from "nock";

import { functionsOrigin } from "../../api";

import * as backend from "../../deploy/functions/backend";
import * as cloudfunctions from "../../gcp/cloudfunctions";

describe("cloudfunctions", () => {
  const FUNCTION_NAME: backend.TargetIds = {
    id: "id",
    region: "region",
    project: "project",
  };

  // Omit a random trigger to make this compile
  const ENDPOINT: Omit<backend.Endpoint, "httpsTrigger"> = {
    platform: "gcfv1",
    ...FUNCTION_NAME,
    entryPoint: "function",
    runtime: "nodejs16",
  };

  const CLOUD_FUNCTION: Omit<cloudfunctions.CloudFunction, cloudfunctions.OutputOnlyFields> = {
    name: "projects/project/locations/region/functions/id",
    entryPoint: "function",
    runtime: "nodejs16",
  };

  const HAVE_CLOUD_FUNCTION: cloudfunctions.CloudFunction = {
    ...CLOUD_FUNCTION,
    buildId: "buildId",
    versionId: 1,
    updateTime: new Date(),
    status: "ACTIVE",
  };

  before(() => {
    nock.disableNetConnect();
  });

  after(() => {
    expect(nock.isDone()).to.be.true;
    nock.enableNetConnect();
  });

  describe("functionFromEndpoint", () => {
    const UPLOAD_URL = "https://storage.googleapis.com/projects/-/buckets/sample/source.zip";
    it("should guard against version mixing", () => {
      expect(() => {
        cloudfunctions.functionFromEndpoint(
          { ...ENDPOINT, platform: "gcfv2", httpsTrigger: {} },
          UPLOAD_URL
        );
      }).to.throw;
    });

    it("should copy a minimal function", () => {
      expect(
        cloudfunctions.functionFromEndpoint({ ...ENDPOINT, httpsTrigger: {} }, UPLOAD_URL)
      ).to.deep.equal({
        ...CLOUD_FUNCTION,
        sourceUploadUrl: UPLOAD_URL,
        httpsTrigger: {},
      });

      const eventEndpoint = {
        ...ENDPOINT,
        eventTrigger: {
          eventType: "google.pubsub.topic.publish",
          eventFilters: {
            resource: "projects/p/topics/t",
          },
          retry: false,
        },
      };
      const eventGcfFunction = {
        ...CLOUD_FUNCTION,
        sourceUploadUrl: UPLOAD_URL,
        eventTrigger: {
          eventType: "google.pubsub.topic.publish",
          resource: "projects/p/topics/t",
          failurePolicy: undefined,
        },
      };
      expect(cloudfunctions.functionFromEndpoint(eventEndpoint, UPLOAD_URL)).to.deep.equal(
        eventGcfFunction
      );
    });

    it("should copy trival fields", () => {
      const fullEndpoint: backend.Endpoint = {
        ...ENDPOINT,
        httpsTrigger: {},
        availableMemoryMb: 128,
        minInstances: 1,
        maxInstances: 42,
        vpc: {
          connector: "connector",
          egressSettings: "ALL_TRAFFIC",
        },
        ingressSettings: "ALLOW_ALL",
        timeout: "15s",
        serviceAccountEmail: "inlined@google.com",
        labels: {
          foo: "bar",
        },
        environmentVariables: {
          FOO: "bar",
        },
      };

      const fullGcfFunction: Omit<cloudfunctions.CloudFunction, cloudfunctions.OutputOnlyFields> = {
        ...CLOUD_FUNCTION,
        sourceUploadUrl: UPLOAD_URL,
        httpsTrigger: {},
        labels: {
          foo: "bar",
        },
        environmentVariables: {
          FOO: "bar",
        },
        maxInstances: 42,
        minInstances: 1,
        vpcConnector: "connector",
        vpcConnectorEgressSettings: "ALL_TRAFFIC",
        ingressSettings: "ALLOW_ALL",
        availableMemoryMb: 128,
        timeout: "15s",
        serviceAccountEmail: "inlined@google.com",
      };

      expect(cloudfunctions.functionFromEndpoint(fullEndpoint, UPLOAD_URL)).to.deep.equal(
        fullGcfFunction
      );
    });

    it("should calculate non-trivial fields", () => {
      const complexEndpoint: backend.Endpoint = {
        ...ENDPOINT,
        scheduleTrigger: {},
      };

      const complexGcfFunction: Omit<
        cloudfunctions.CloudFunction,
        cloudfunctions.OutputOnlyFields
      > = {
        ...CLOUD_FUNCTION,
        sourceUploadUrl: UPLOAD_URL,
        eventTrigger: {
          eventType: "google.pubsub.topic.publish",
          resource: `projects/project/topics/${backend.scheduleIdForFunction(FUNCTION_NAME)}`,
        },
        labels: {
          "deployment-scheduled": "true",
        },
      };

      expect(cloudfunctions.functionFromEndpoint(complexEndpoint, UPLOAD_URL)).to.deep.equal(
        complexGcfFunction
      );
    });

    it("detects task queue functions", () => {
      const taskEndpoint: backend.Endpoint = {
        ...ENDPOINT,
        taskQueueTrigger: {},
      };
      const taskQueueFunction: Omit<cloudfunctions.CloudFunction, cloudfunctions.OutputOnlyFields> =
        {
          ...CLOUD_FUNCTION,
          sourceUploadUrl: UPLOAD_URL,
          httpsTrigger: {},
          labels: {
            "deployment-taskqueue": "true",
          },
        };

      expect(cloudfunctions.functionFromEndpoint(taskEndpoint, UPLOAD_URL)).to.deep.equal(
        taskQueueFunction
      );
    });
  });

  describe("endpointFromFunction", () => {
    it("should copy a minimal version", () => {
      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          httpsTrigger: {},
        })
      ).to.deep.equal({ ...ENDPOINT, httpsTrigger: {} });
    });

    it("should translate event triggers", () => {
      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          eventTrigger: {
            eventType: "google.pubsub.topic.publish",
            resource: "projects/p/topics/t",
            failurePolicy: {
              retry: {},
            },
          },
        })
      ).to.deep.equal({
        ...ENDPOINT,
        eventTrigger: {
          eventType: "google.pubsub.topic.publish",
          eventFilters: {
            resource: "projects/p/topics/t",
          },
          retry: true,
        },
      });

      // And again w/o the failure policy
      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          eventTrigger: {
            eventType: "google.pubsub.topic.publish",
            resource: "projects/p/topics/t",
          },
        })
      ).to.deep.equal({
        ...ENDPOINT,
        eventTrigger: {
          eventType: "google.pubsub.topic.publish",
          eventFilters: {
            resource: "projects/p/topics/t",
          },
          retry: false,
        },
      });
    });

    it("should transalte scheduled triggers", () => {
      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          eventTrigger: {
            eventType: "google.pubsub.topic.publish",
            resource: "projects/p/topics/t",
            failurePolicy: {
              retry: {},
            },
          },
          labels: {
            "deployment-scheduled": "true",
          },
        })
      ).to.deep.equal({
        ...ENDPOINT,
        scheduleTrigger: {},
        labels: {
          "deployment-scheduled": "true",
        },
      });
    });

    it("should translate task queue triggers", () => {
      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          httpsTrigger: {},
          labels: {
            "deployment-taskqueue": "true",
          },
        })
      ).to.deep.equal({
        ...ENDPOINT,
        taskQueueTrigger: {},
        labels: {
          "deployment-taskqueue": "true",
        },
      });
    });

    it("should copy optional fields", () => {
      const extraFields: Partial<backend.Endpoint> = {
        availableMemoryMb: 128,
        minInstances: 1,
        maxInstances: 42,
        ingressSettings: "ALLOW_ALL",
        serviceAccountEmail: "inlined@google.com",
        timeout: "15s",
        labels: {
          foo: "bar",
        },
        environmentVariables: {
          FOO: "bar",
        },
      };
      const vpcConnector = "connector";
      const vpcConnectorEgressSettings = "ALL_TRAFFIC";

      expect(
        cloudfunctions.endpointFromFunction({
          ...HAVE_CLOUD_FUNCTION,
          ...extraFields,
          vpcConnector,
          vpcConnectorEgressSettings,
          httpsTrigger: {},
        } as cloudfunctions.CloudFunction)
      ).to.deep.equal({
        ...ENDPOINT,
        ...extraFields,
        vpc: {
          connector: vpcConnector,
          egressSettings: vpcConnectorEgressSettings,
        },
        httpsTrigger: {},
      });
    });
  });

  describe("setInvokerCreate", () => {
    it("should reject on emtpy invoker array", async () => {
      await expect(cloudfunctions.setInvokerCreate("project", "function", [])).to.be.rejected;
    });

    it("should reject if the setting the IAM policy fails", async () => {
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [{ role: "roles/cloudfunctions.invoker", members: ["allUsers"] }],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(418, {});

      await expect(
        cloudfunctions.setInvokerCreate("project", "function", ["public"])
      ).to.be.rejectedWith("Failed to set the IAM Policy on the function function");
    });

    it("should set a private policy on a function", async () => {
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [{ role: "roles/cloudfunctions.invoker", members: [] }],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(cloudfunctions.setInvokerCreate("project", "function", ["private"])).to.not.be
        .rejected;
    });

    it("should set a public policy on a function", async () => {
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [{ role: "roles/cloudfunctions.invoker", members: ["allUsers"] }],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(cloudfunctions.setInvokerCreate("project", "function", ["public"])).to.not.be
        .rejected;
    });

    it("should set the policy with a set of invokers with active policies", async () => {
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [
              {
                role: "roles/cloudfunctions.invoker",
                members: [
                  "serviceAccount:service-account1@project.iam.gserviceaccount.com",
                  "serviceAccount:service-account2@project.iam.gserviceaccount.com",
                  "serviceAccount:service-account3@project.iam.gserviceaccount.com",
                ],
              },
            ],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(
        cloudfunctions.setInvokerCreate("project", "function", [
          "service-account1@",
          "service-account2@project.iam.gserviceaccount.com",
          "service-account3@",
        ])
      ).to.not.be.rejected;
    });
  });

  describe("setInvokerUpdate", () => {
    it("should reject on emtpy invoker array", async () => {
      await expect(cloudfunctions.setInvokerUpdate("project", "function", [])).to.be.rejected;
    });

    it("should reject if the getting the IAM policy fails", async () => {
      nock(functionsOrigin).get("/v1/function:getIamPolicy").reply(404, {});

      await expect(
        cloudfunctions.setInvokerUpdate("project", "function", ["public"])
      ).to.be.rejectedWith("Failed to get the IAM Policy on the function function");
    });

    it("should reject if the setting the IAM policy fails", async () => {
      nock(functionsOrigin).get("/v1/function:getIamPolicy").reply(200, {});
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [{ role: "roles/cloudfunctions.invoker", members: ["allUsers"] }],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(418, {});

      await expect(
        cloudfunctions.setInvokerUpdate("project", "function", ["public"])
      ).to.be.rejectedWith("Failed to set the IAM Policy on the function function");
    });

    it("should set a basic policy on a function without any polices", async () => {
      nock(functionsOrigin).get("/v1/function:getIamPolicy").reply(200, {});
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [{ role: "roles/cloudfunctions.invoker", members: ["allUsers"] }],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(cloudfunctions.setInvokerUpdate("project", "function", ["public"])).to.not.be
        .rejected;
    });

    it("should set the policy with private invoker with active policies", async () => {
      nock(functionsOrigin)
        .get("/v1/function:getIamPolicy")
        .reply(200, {
          bindings: [
            { role: "random-role", members: ["user:pineapple"] },
            { role: "roles/cloudfunctions.invoker", members: ["some-service-account"] },
          ],
          etag: "1234",
          version: 3,
        });
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [
              { role: "random-role", members: ["user:pineapple"] },
              { role: "roles/cloudfunctions.invoker", members: [] },
            ],
            etag: "1234",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(cloudfunctions.setInvokerUpdate("project", "function", ["private"])).to.not.be
        .rejected;
    });

    it("should set the policy with a set of invokers with active policies", async () => {
      nock(functionsOrigin).get("/v1/function:getIamPolicy").reply(200, {});
      nock(functionsOrigin)
        .post("/v1/function:setIamPolicy", {
          policy: {
            bindings: [
              {
                role: "roles/cloudfunctions.invoker",
                members: [
                  "serviceAccount:service-account1@project.iam.gserviceaccount.com",
                  "serviceAccount:service-account2@project.iam.gserviceaccount.com",
                  "serviceAccount:service-account3@project.iam.gserviceaccount.com",
                ],
              },
            ],
            etag: "",
            version: 3,
          },
          updateMask: "bindings,etag,version",
        })
        .reply(200, {});

      await expect(
        cloudfunctions.setInvokerUpdate("project", "function", [
          "service-account1@",
          "service-account2@project.iam.gserviceaccount.com",
          "service-account3@",
        ])
      ).to.not.be.rejected;
    });

    it("should not set the policy if the set of invokers is the same as the current invokers", async () => {
      nock(functionsOrigin)
        .get("/v1/function:getIamPolicy")
        .reply(200, {
          bindings: [
            {
              role: "roles/cloudfunctions.invoker",
              members: [
                "serviceAccount:service-account1@project.iam.gserviceaccount.com",
                "serviceAccount:service-account3@project.iam.gserviceaccount.com",
                "serviceAccount:service-account2@project.iam.gserviceaccount.com",
              ],
            },
          ],
          etag: "1234",
          version: 3,
        });

      await expect(
        cloudfunctions.setInvokerUpdate("project", "function", [
          "service-account2@project.iam.gserviceaccount.com",
          "service-account3@",
          "service-account1@",
        ])
      ).to.not.be.rejected;
    });
  });
});
