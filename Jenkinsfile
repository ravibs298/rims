// Declarative pipeline. Requires on the agent: Node 22, Docker, AWS CLI v2, kubectl, envsubst (gettext).
// Jenkins credentials: 'aws-ecr-deploy' (AWS credentials binding, IAM user/role scoped to ECR push + eks:DescribeCluster).
pipeline {
  agent any
  options { timestamps(); disableConcurrentBuilds(); timeout(time: 60, unit: 'MINUTES') }
  environment {
    AWS_REGION   = 'us-east-1'
    AWS_ACCOUNT  = credentials('aws-account-id')           // secret text
    ECR_REGISTRY = "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    EKS_CLUSTER  = 'rims-prod'
    IMAGE_TAG    = "${env.GIT_COMMIT?.take(12) ?: env.BUILD_NUMBER}"
    JWT_SECRET   = 'ci-only-secret-ci-only-secret-ci-only-0000'
  }
  stages {
    stage('Install') { steps { sh 'npm ci' } }
    stage('Lint & typecheck') {
      parallel {
        stage('Lint') { steps { sh 'npm run lint' } }
        stage('Typecheck') { steps { sh 'npm run typecheck' } }
      }
    }
    stage('Unit tests') { steps { sh 'npm run test:unit' } }
    stage('Integration tests (MySQL)') {
      steps {
        sh '''
          docker rm -f rims-ci-mysql >/dev/null 2>&1 || true
          docker run -d --name rims-ci-mysql -e MYSQL_ROOT_PASSWORD=ci -e MYSQL_DATABASE=rims_test \
            -e MYSQL_USER=rims -e MYSQL_PASSWORD=ci -p 33306:3306 mysql:8.0
          for i in $(seq 1 60); do docker exec rims-ci-mysql mysqladmin ping -h localhost -uroot -pci --silent && break; sleep 2; done
          TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=33306 TEST_DB_USER=root TEST_DB_PASSWORD=ci TEST_DB_NAME=rims_test npm run test:integration
        '''
      }
      post { always { sh 'docker rm -f rims-ci-mysql || true' } }
    }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Docker build') {
      steps {
        sh '''
          docker build -f backend/Dockerfile  -t rims-backend:${IMAGE_TAG}  .
          docker build -f frontend/Dockerfile -t rims-frontend:${IMAGE_TAG} .
        '''
      }
    }
    stage('End-to-end (Cypress)') {
      steps {
        sh '''
          docker compose -p rims-ci up -d --build
          for i in $(seq 1 60); do curl -fs http://localhost:4000/ready && break; sleep 3; done
          SEED_PASSWORD=ChangeMe-2026-dev DB_HOST=127.0.0.1 DB_USER=rims DB_PASSWORD=rims_dev_password DB_NAME=rims npm run seed
          CYPRESS_BASE_URL=http://localhost:8080 CYPRESS_API_URL=http://localhost:4000/api/v1 npm run test:e2e
        '''
      }
      post { always { sh 'docker compose -p rims-ci down -v || true' } }
    }
    stage('Push images') {
      when { branch 'main' }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-deploy']]) {
          sh '''
            aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
            for svc in backend frontend; do
              docker tag rims-$svc:${IMAGE_TAG} $ECR_REGISTRY/rims-$svc:${IMAGE_TAG}
              docker push $ECR_REGISTRY/rims-$svc:${IMAGE_TAG}
            done
          '''
        }
      }
    }
    stage('Approve production deploy') {
      when { branch 'main' }
      steps { input message: "Deploy ${IMAGE_TAG} to production? Database migrations will run first.", ok: 'Deploy' }
    }
    stage('Migrate & deploy') {
      when { branch 'main' }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-deploy']]) {
          sh '''
            aws eks update-kubeconfig --name $EKS_CLUSTER --region $AWS_REGION
            envsubst < k8s/40-migrate-job.yaml | kubectl apply -f -
            kubectl -n rims wait --for=condition=complete --timeout=300s job/rims-migrate-${IMAGE_TAG}
            for f in k8s/00-namespace-config.yaml k8s/10-backend.yaml k8s/20-frontend.yaml k8s/30-ingress.yaml; do envsubst < $f | kubectl apply -f -; done
            kubectl -n rims rollout status deploy/rims-backend  --timeout=300s
            kubectl -n rims rollout status deploy/rims-frontend --timeout=300s
          '''
        }
      }
      post {
        failure {
          withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-deploy']]) {
            sh '''
              echo "Deployment failed: rolling back application images (database migrations are forward-only; see docs/DEPLOYMENT.md)"
              kubectl -n rims rollout undo deploy/rims-backend  || true
              kubectl -n rims rollout undo deploy/rims-frontend || true
            '''
          }
        }
      }
    }
  }
}
