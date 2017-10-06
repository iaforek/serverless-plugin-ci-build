'use strict';

const fse = require('fs-extra');
const path = require('path');
const uuidV4 = require('uuid/v4');
const chalk = require('chalk');

class AnsibleBuild {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.uuidRegion = uuidV4();
    this.uuidStage = uuidV4();
    this.ansible = this.serverless.service.custom ? this.serverless.service.custom.ansible : {};

    // @todo if deployment bucket is set it should be removed when deploying with noDeploy
    // this.uuidDeploymentBucket = uuidV4();

    if (this.options.ansible) {
      this.options = Object.assign(this.options,
        {
          noDeploy: true,
          stage: this.ansible.templateStage || this.uuidStage,
          region: this.ansible.templateRegion || this.uuidRegion,
        });
    }

    // @todo create sls build ansible command
    this.commands = {
      // build: {
      //   commands: {
      //     ansible: {
      //       usage: 'Builds ansible j2 template',
      //       lifecycleEvents: ['build'],
      //     },
      //   },
      // },
    };

    this.hooks = {
      'after:deploy:deploy': this.createArtifacts.bind(this),
    };
  }

  createArtifacts() {
    if (this.options.ansible) {
      const stack =
        JSON.parse(fse.readFileSync(path.join('.serverless', 'cloudformation-template-update-stack.json'), 'utf8'));

      delete stack.Resources.ServerlessDeploymentBucket;

      const ServerlessDeploymentBucket = {
        Type: 'String',
        Description: 'Deployment Bucket Name',
      };

      if (!stack.Parameters) {
        stack.Parameters = {};
      }

      Object.assign(stack.Parameters, { ServerlessDeploymentBucket });

      const serviceName = this.serverless.service.service;

      const replacer = (key, value) => {
        if (typeof (value) === 'string') {
          const ansibleStage = this.ansible.stage || '{{ stage }}';
          const ansibleRegion = this.ansible.region || '{{ region }}';
          const ansibleArtifact = this.ansible.artifactPath || '{{ artifact_path }}';
          const regexStage = new RegExp(this.options.stage, 'g');
          const regexRegion = new RegExp(this.options.region, 'g');
          const regexArtifact = new RegExp(`serverless/${serviceName}/${ansibleStage}/[0-9-T:.Z]+/${serviceName}.zip`, 'g');
          // shorter (serverless\/${serviceName})(.*)(${serviceName}\.zip)
          return value.replace(regexStage, ansibleStage)
            .replace(regexRegion, ansibleRegion)
            .replace(regexArtifact, `${ansibleArtifact}/${serviceName}.zip`);
        }
        return value;
      };

      const ansibleDir = this.ansible.buildDirectory || '.ansible';
      const templatePath = path.join(ansibleDir, `${serviceName}.json.j2`);

      // Create ansible deployment directory
      fse.mkdirsSync(ansibleDir);

      // Save template
      const template = JSON.stringify(stack, replacer, 2);
      fse.writeFileSync(templatePath, template);
      this.log(`Created ansible template ${templatePath}`);

      Object.keys(this.serverless.service.functions).reduce((result, key) => {
        const artifact = this.serverless.service.functions[key].package.artifact;
        if (result.indexOf(artifact) === -1) {
          result.push(artifact);
        }
        return result;
      }, [])
        .forEach((zipfile) => {
          const zipfilename = path.parse(zipfile).base;
          // Copy zip
          fse.copySync(
            zipfile,
            path.join(ansibleDir, zipfilename));
          this.log(`Copied zip ${zipfilename} to ${ansibleDir}/${zipfilename}`);
        });
    }
  }

  log(message) {
    this.serverless.cli.consoleLog(`Serverless Ansible Build Plugin: ${chalk.yellow(message)}`);
  }
}

module.exports = AnsibleBuild;
