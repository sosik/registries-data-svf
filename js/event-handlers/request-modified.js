(function() {
	'use strict';

	var log = require(process.cwd() + '/build/server/logging.js').getLogger('handlers/RequestChangedHandler.js');
	var objectTools = require(process.cwd() + '/build/server/ObjectTools.js');
	var universalDaoModule = require(process.cwd() + '/build/server/UniversalDao.js');
	var dateUtils = require(process.cwd()+'/build/server/DateUtils.js').DateUtils;
	var QueryFilter = require(process.cwd()+'/build/server/QueryFilter.js');

	var nodemailer = module.parent.require('nodemailer');
	var renderModule =  module.parent.require('./renderService.js');
	var transport = nodemailer.createTransport('Sendmail');


	/**
	*	@module server
	*	@submodule event.handler
	*	@class RequestChangedHandler
	*/
	function RequestChangedHandler(ctx) {
		this.ctx=ctx;
		var self=this;
		var renderService = new renderModule.RenderService();

		var requestsDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: 'requests'}
		);

		var userDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: 'people'}
		);

		/**
			Method handles <b>event-request-created<b> event.
			<br>Method does:
			<li>updates/initializes requests attributes setupDate,applicant,status,assignedTo</li>
			<li>sends notification mail to cfg defined issue solver ('requestSolverAddress') </li>
			<br>
			Limitations: requestSolverAddress should match to systemCredentials.login.email of any user othewise attribute 'assignedTo' is not resolved.

			@method handleRequestCreated

		*/
		this.handleRequestCreated=function(event){

			var entity = event.entity;
			var solverAddress=this.ctx.config.mails.requestSolverAddress;
			
			console.log('mmmmmmmmmmmmmm: ' + JSON.stringify(event));

				entity.requestData = {};
				entity.requestData.setupDate=dateUtils.nowToReverse();
				entity.requestData.status='created';
				entity.requestData.applicant={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:event.user.id};
				entity.requestData.clubApplicant={schema:"uri://registries/organizations#views/club-km/view",registry:'organizations',oid:event.user.officer.club.oid};


				var qf=QueryFilter.create();
				qf.addCriterium("systemCredentials.login.email","eq",solverAddress);

				userDao.find(qf, function(err, data) {
					if (err){
						log.error(err);
						return;
					}

					// assign to and send mail.
					if (data.length==1){
						var solver=data[0];
						
							entity.requestData.assignedTo={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:solver.id};
						
						
					}
					self.sendRequestCreated(solverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);

					requestsDao.save(entity,function(err,data){
						if (err) {
							log.error(err);
							return;
						}
						log.debug('requests created: event handled');
					});

				});

		};

		/**
			Method handles <b>event-request-updated</b>
			@method handleRequestModified
		*/
		this.handleRequestModified=function(event){

			var entity = event.entity;
			// var solverAddress=this.ctx.config.mails.requestSolverAddress;

			// if (entity.requestData) {

			entity.requestData.applicant={schema:"uri://registries/people#views/fullperson/view",registry:'people',oid:event.user.id};
			var solverAddress=self.ctx.config.mails.requestSolverAddress;

				if (entity.requestData.assignedTo){
					userDao.get(entity.requestData.assignedTo.oid, function(err, solver) {
						if (err){
							log.error(err);
							return;
						}

						// assign to and send mail.
						if (solver){
							self.sendRequestModified(solver.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
						}
					});

				} else {
					self.sendRequestModified(this.ctx.config.mails.requestSolverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
				}

				if (entity.requestData.applicant){
							userDao.get(entity.requestData.applicant.oid,function(err,applicant){
								if (err){
									log.error(err);
									return;
								}
								self.sendRequestModified(applicant.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
							});
				}
			// }
		}


		this.sendRequestCreated=function(email,serviceUrl,applicant,subject,requestUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Nová žiadosť',
				html : renderService.render(renderModule.templates.REQUEST_CREATED_HTML,{applicant:applicant,subject:subject,serviceUrl:serviceUrl,requestUri:requestUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};
		this.sendRequestModified=function(email,serviceUrl,modifier,subject,requestUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Upravená žiadosť',
				html : renderService.render(renderModule.templates.REQUEST_UPDATED_HTML,{modifier:modifier,subject:subject,serviceUrl:serviceUrl,requestUri:requestUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};

	}
	/**
	* method dispatch all types of registered events to actual handling method.
	* @method handle
	*/
	RequestChangedHandler.prototype.handle = function(event) {
		log.info('handle called',event,RequestChangedHandler.prototype.ctx);

		if ('event-request-created' === event.eventType){
			this.handleRequestCreated(event);
		}else if ('event-request-updated' === event.eventType){
			this.handleRequestModified(event);
		}
	};

	RequestChangedHandler.prototype.getType=function(){
		return ["event-request-created","event-request-updated"];
	};

	module.exports = function( ctx) {
		return new RequestChangedHandler(ctx );
	};
}());
